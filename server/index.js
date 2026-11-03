// server/index.js
//
// 短剧漫剧聚合播放器 —— 后端源服务（ESM）。
//
// 职责：
//   1. 静态托管本项目的 Web 播放器前端（index.html / assets）。
//   2. 提供只读内容源接口，底层对接开源社区非官方 SDK `openhongguo`（红果短剧接口）。
//
// 合规边界（务必阅读）：
//   - 本项目【不托管、不存储、不解析改写】任何视频内容；所有剧集元数据与播放地址
//     均来自上游 openhongguo / 红果接口的实时转发，且播放地址为带签名的临时直链。
//   - openhongguo 仅限个人学习 / 技术研究使用，禁止商用；内容版权归原平台所有。
//   - 如需接入其他平台源，请在 `sources` 处按相同契约扩展。
//
// 关于「匿名设备限额」：
//   openhongguo 仅以匿名设备身份访问红果，红果对游客有配额/频率限制
//   （错误码 ANONYMOUS_LIMITED / RATE_LIMITED）。本服务做了两件事来缓解：
//     - 元数据接口（home/search/detail）加内存缓存，避免浏览时反复消耗配额；
//     - 播放接口尊重服务端建议的退避时间，并在受限后进入短期冷却，避免狂点加重限制。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, OpenhongguoError, fileProfileStore } from "openhongguo";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8788;

// openhongguo 的 createClient 需要加载 wasm，较重；复用单例，避免每个请求重建。
// 设备档案持久化在项目本地，跨重启复用同一台设备（比每次新建更不容易被当成滥用）。
let _client = null;
function getClient() {
  if (!_client) {
    _client = createClient({
      profile: fileProfileStore(path.join(ROOT, ".openhongguo-profile.json")),
      retryAttempts: 2,
    });
  }
  return _client;
}

// ---------- 轻量内存缓存（仅缓存元数据，播放直链不过期缓存） ----------
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const _cache = new Map(); // key -> { ts, data }
async function cached(key, producer) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  const data = await producer();
  _cache.set(key, { ts: Date.now(), data });
  return data;
}

// ---------- 播放冷却（防止狂点加重匿名限额） ----------
let playCooldownUntil = 0;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(obj));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 内容源接口 ----------

async function apiHome() {
  const c = await getClient();
  // 各子调用独立容错：任一上游方法异常都不拖垮整个首页。
  const [hotR, nrR, catsR] = await Promise.allSettled([
    c.hotSearch(),
    c.newReleases(),
    c.categories("真人剧"),
  ]);
  const hot = hotR.status === "fulfilled" ? hotR.value : null;
  const nr = nrR.status === "fulfilled" ? nrR.value : null;
  const cats = catsR.status === "fulfilled" ? catsR.value : null;
  const hotItems = (hot?.guesses || []).map((g) => ({
    id: g.series_id,
    title: g.title,
    cover: g.cover_url || "",
    heat: g.heat || "",
    tag: g.tag || "",
    episode_count: g.episode_count || 0,
    type: g.content_type,
  }));
  const newItems = (nr?.items || []).map((x) => ({
    id: x.series_id,
    title: x.title,
    cover: x.cover_url || "",
    heat: x.heat || "",
    episode_count: x.episode_count || 0,
    categories: x.categories || [],
  }));
  const tabs = (cats?.tabs || []).map((t) => ({ name: t.name, value: t.value }));
  return { hot: hotItems, newReleases: newItems, categories: tabs };
}

async function apiSearch(q) {
  const c = await getClient();
  const r = await c.search(q);
  const items = (r.items || []).map((x) => ({
    id: x.id,
    title: x.title,
    description: x.description || "",
    episode_count: x.episode_count || 0,
    type: x.content_type,
  }));
  return { items, has_more: !!r.has_more };
}

async function apiDetail(id) {
  const c = await getClient();
  const [series, eps, rec] = await Promise.all([
    c.getSeries(id),
    c.listEpisodes(id),
    c.seriesRecommend(id).catch(() => ({ items: [] })),
  ]);
  const cover = eps.items?.[0]?.cover_url || series.cover_url || "";
  const episodes = (eps.items || []).map((e) => ({
    id: e.id,
    number: e.number,
    title: e.title || `第${e.number}集`,
    cover: e.cover_url || "",
  }));
  const recommend = (rec.items || []).map((x) => ({
    id: x.id,
    title: x.title,
    cover: x.cover_url || "",
    episode_count: x.episode_count || 0,
  }));
  return {
    id,
    title: series.title,
    description: series.description || "",
    cover,
    episode_count: series.episode_count || episodes.length,
    heat: series.heat || "",
    status: series.status,
    type: series.content_type,
    episodes,
    recommend,
  };
}

async function apiPlay(res, episodeId) {
  // 冷却期：刚受限不久，直接提示等待，避免狂点把限额雪上加霜。
  const now = Date.now();
  if (now < playCooldownUntil) {
    const waitSec = Math.ceil((playCooldownUntil - now) / 1000);
    return sendJson(res, 503, {
      error: `源暂时受限（匿名设备限额），请 ${waitSec} 秒后再试。`,
      retryAfter: waitSec,
    });
  }

  const c = await getClient();
  let lastErr = null;
  // 最多尝试 2 次；尊重服务端建议的退避时间。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const pb = await c.resolvePlayback(episodeId);
      if (pb && pb.streams && pb.streams.length) {
        const streams = pb.streams
          .slice()
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        const best = streams[0];
        return sendJson(res, 200, {
          url: best?.url || "",
          definition: best?.definition || "",
          streams: streams.map((s) => ({
            definition: s.definition,
            url: s.url,
            height: s.height,
            codec: s.codec,
          })),
        });
      }
      lastErr = new Error("上游返回空播放列表");
    } catch (e) {
      lastErr = e;
      if (e instanceof OpenhongguoError) {
        // 不可重试的错误（如内容不可用）直接失败，不再浪费配额。
        if (!e.retryable) {
          break;
        }
        const wait = e.retryAfterMs && e.retryAfterMs > 0 ? e.retryAfterMs : 2000;
        await sleep(wait);
        continue;
      }
    }
    await sleep(2000);
  }

  // 失败：进入冷却，并提示。
  const code =
    lastErr instanceof OpenhongguoError ? lastErr.code : "UNKNOWN";
  const limited =
    code === "ANONYMOUS_LIMITED" || code === "RATE_LIMITED" || code === "DEVICE_REJECTED";
  if (limited) {
    playCooldownUntil = Date.now() + 30 * 1000; // 冷却 30 秒
  }
  return sendJson(res, 502, {
    error: "源暂时受限（匿名设备限额），请稍后重试或更换剧集。",
    code,
  });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (p === "/api/home")
      return sendJson(res, 200, await cached("home", () => apiHome()));
    if (p === "/api/search") {
      const q = url.searchParams.get("q") || "";
      return sendJson(
        res,
        200,
        await cached("search:" + q, () => apiSearch(q))
      );
    }
    if (p === "/api/detail") {
      const id = url.searchParams.get("id") || "";
      return sendJson(
        res,
        200,
        await cached("detail:" + id, () => apiDetail(id))
      );
    }
    if (p === "/api/play")
      return await apiPlay(res, url.searchParams.get("episodeId") || "");
    sendJson(res, 404, { error: "unknown api" });
  } catch (e) {
    console.error("[API ERROR]", url.pathname, e);
    sendJson(res, 502, { error: String(e?.message || e) });
  }
}

// ---------- 静态托管 ----------
function serveStatic(req, res, url) {
  let fp = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
  if (!fp.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(fp, (err, data) => {
    if (err) {
      // SPA 回退到 index.html
      fs.readFile(path.join(ROOT, "index.html"), (e2, html) => {
        if (e2) {
          res.writeHead(404);
          res.end("404");
        } else {
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          res.end(html);
        }
      });
      return;
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Short Drama Hub 播放器已启动: http://127.0.0.1:${PORT}`);
  console.log(`内容源: openhongguo (红果短剧非官方接口, 仅供个人学习/非商用)`);
});
