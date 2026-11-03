// server/index.js
//
// 短剧漫剧聚合播放器 —— 后端源服务（ESM，零构建，Node 18+）。
//
// 架构：内容源可插拔（Source Registry）
//   ┌─ hongguo ── 开源社区非官方 SDK `openhongguo`（红果短剧）── 有匿名设备限额
//   ├─ local   ── 本地片库（media-manifest.json，用户自有内容）──── 零限额
//   └─ custom  ── 前端「自定义源」模式，粘贴 m3u8 / mp4 / JSON API ─ 零限额
//
// 每个源实现同一套契约：home() / search(q) / detail(id) / play(episodeId)，
// 返回结构一致，前端无需感知差异（切换内容源只换 ?source= 参数）。
//
// 合规边界（务必阅读）：
//   - 本项目【不托管、不存储、不解析改写】任何视频内容；剧集元数据与播放地址
//     均来自上游接口的实时转发，播放地址为带签名的临时直链。
//   - openhongguo 仅限个人学习 / 技术研究使用，禁止商用；内容版权归原平台所有。
//   - /api/proxy 只做带宽透传（支持 Range / 重定向），不缓存、不落盘、不改写内容，
//     用途是让用户自有/自选的自定义源绕开 CORS 与防盗链限制。
//   - 如需接入其他平台源，在 SOURCES 处按相同契约扩展即可。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient, OpenhongguoError, fileProfileStore } from "openhongguo";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8788;
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ============================================================================
// 源 1：红果短剧（openhongguo）
// ============================================================================

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

async function hongguoHome() {
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
  const warning =
    hotR.status === "rejected" && nrR.status === "rejected"
      ? "红果源当前受限（匿名设备限额），请改用「本地片库」或「自定义源」。"
      : "";
  return { hot: hotItems, newReleases: newItems, categories: tabs, warning };
}

async function hongguoSearch(q) {
  const c = await getClient();
  const r = await c.search(q);
  const items = (r.items || []).map((x) => ({
    id: x.id,
    title: x.title,
    description: x.description || "",
    episode_count: x.episode_count || 0,
    cover: x.cover_url || "",
    type: x.content_type,
  }));
  return { items, has_more: !!r.has_more };
}

async function hongguoDetail(id) {
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

// 播放冷却（防止狂点把匿名限额打爆）
let playCooldownUntil = 0;

async function hongguoPlay(episodeId) {
  const now = Date.now();
  if (now < playCooldownUntil) {
    const waitSec = Math.ceil((playCooldownUntil - now) / 1000);
    const e = new Error(`源暂时受限（匿名设备限额），请 ${waitSec} 秒后再试。`);
    e.code = "COOLDOWN";
    e.retryAfter = waitSec;
    throw e;
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
        return {
          url: best?.url || "",
          definition: best?.definition || "",
          proxy: false, // 红果为带签名的临时直链，直连即可
          streams: streams.map((s) => ({
            definition: s.definition,
            url: s.url,
            height: s.height,
            codec: s.codec,
            proxy: false,
          })),
        };
      }
      lastErr = new Error("上游返回空播放列表");
    } catch (e) {
      lastErr = e;
      if (e instanceof OpenhongguoError) {
        // 不可重试的错误（如内容不可用）直接失败，不再浪费配额。
        if (!e.retryable) break;
        const wait = e.retryAfterMs && e.retryAfterMs > 0 ? e.retryAfterMs : 2000;
        await sleep(wait);
        continue;
      }
    }
    await sleep(2000);
  }

  const code = lastErr instanceof OpenhongguoError ? lastErr.code : "UNKNOWN";
  const limited =
    code === "ANONYMOUS_LIMITED" ||
    code === "RATE_LIMITED" ||
    code === "DEVICE_REJECTED";
  if (limited) playCooldownUntil = Date.now() + 30 * 1000; // 冷却 30 秒
  const e = new Error("源暂时受限（匿名设备限额），请稍后重试，或改用「本地片库 / 自定义源」。");
  e.code = limited ? code : "UNKNOWN";
  throw e;
}

// ============================================================================
// 源 2：本地片库（零限额）
// ============================================================================

// 媒体清单：用户在项目根目录维护 media-manifest.json，描述自己的剧集。
// 结构：
// {
//   "series": [{
//     "id": "demo", "title": "示例剧", "cover": "", "description": "",
//     "episodes": [{ "title": "第1集", "url": "https://.../ep1.mp4" },
//                  { "title": "第2集", "url": "https://.../ep2.m3u8" }]
//   }]
// }
const LOCAL_MANIFEST = path.join(ROOT, "media-manifest.json");

function readLocalManifest() {
  try {
    const raw = fs.readFileSync(LOCAL_MANIFEST, "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j?.series) ? j.series : [];
  } catch (_) {
    return [];
  }
}

function isM3u8(url) {
  return /\.m3u8(\?|#|$)/i.test(url || "");
}

function normalizeLocalSeries() {
  return readLocalManifest().map((s, si) => {
    const sid = String(s.id || `local-${si + 1}`);
    const eps = (s.episodes || []).map((e, ei) => ({
      id: `${sid}::${ei + 1}`,
      number: ei + 1,
      title: e.title || `第${ei + 1}集`,
      url: e.url || "",
      isM3u8: isM3u8(e.url),
      cover: s.cover || "",
    }));
    return {
      id: sid,
      title: s.title || "未命名",
      cover: s.cover || "",
      description: s.description || "",
      episode_count: eps.length,
      heat: "",
      tag: "本地",
      episodes: eps,
    };
  });
}

async function localHome() {
  const list = normalizeLocalSeries();
  const items = list.map((s) => ({
    id: s.id,
    title: s.title,
    cover: s.cover,
    description: s.description,
    episode_count: s.episode_count,
    heat: "",
    tag: "本地",
  }));
  return {
    hot: items,
    newReleases: items.slice().reverse(),
    categories: [{ name: "本地片库", value: "local" }],
    warning: list.length ? "" : "本地片库为空：请在项目根目录维护 media-manifest.json（README 内有模板）。",
  };
}

async function localSearch(q) {
  const kw = (q || "").trim().toLowerCase();
  const list = normalizeLocalSeries();
  const items = list
    .filter((s) => !kw || s.title.toLowerCase().includes(kw))
    .map((s) => ({
      id: s.id,
      title: s.title,
      cover: s.cover,
      description: s.description,
      episode_count: s.episode_count,
    }));
  return { items, has_more: false };
}

async function localDetail(id) {
  const s = normalizeLocalSeries().find((x) => x.id === String(id));
  if (!s) {
    const e = new Error("本地片库中找不到该剧集");
    e.code = "NOT_FOUND";
    throw e;
  }
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    cover: s.cover,
    episode_count: s.episode_count,
    heat: "",
    tag: "本地",
    episodes: s.episodes.map((e) => ({
      id: e.id,
      number: e.number,
      title: e.title,
      cover: e.cover,
    })),
    recommend: [],
  };
}

async function localPlay(episodeId) {
  for (const s of normalizeLocalSeries()) {
    for (const e of s.episodes) {
      if (e.id === String(episodeId)) {
        return {
          url: e.url,
          definition: "原画",
          proxy: true, // 走本机代理，绕开防盗链 / CORS
          isM3u8: e.isM3u8,
          streams: [
            {
              definition: "原画",
              url: e.url,
              proxy: true,
              isM3u8: e.isM3u8,
            },
          ],
        };
      }
    }
  }
  const e = new Error("本地片库中找不到该分集");
  e.code = "NOT_FOUND";
  throw e;
}

// ============================================================================
// 源注册表
// ============================================================================

const SOURCES = {
  hongguo: {
    id: "hongguo",
    name: "红果短剧",
    desc: "开源社区非官方接口 openhongguo，存在匿名设备限额",
    limited: true,
    home: hongguoHome,
    search: hongguoSearch,
    detail: hongguoDetail,
    play: hongguoPlay,
  },
  local: {
    id: "local",
    name: "本地片库",
    desc: "读取 media-manifest.json，零限额",
    limited: false,
    home: localHome,
    search: localSearch,
    detail: localDetail,
    play: localPlay,
  },
};

const DEFAULT_SOURCE = "hongguo";

function resolveSource(name) {
  return SOURCES[name] || SOURCES[DEFAULT_SOURCE];
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

// ============================================================================
// 流式代理（/api/proxy）—— 让自定义源 / 本地源稳定播放
//   · 支持 Range（拖动进度、边下边播）
//   · 跟随重定向
//   · 可选 referer / UA 覆写（对付防盗链）
//   · 不缓存、不落盘、不改写内容
// ============================================================================

// ---------- m3u8 播放列表重写 ----------
// 目的：让 hls.js / 原生 HLS 拿到一个「所有 URI 都是绝对代理地址」的播放列表。
//  · 相对路径先按播放列表自身的 URL 解析为绝对地址（否则分段会 404）；
//  · 再把每个 URI 换成本机代理地址（解决防盗链 + CORS + 跨域限制）。
// 逐层递归生效：主播放列表 → 子播放列表 → 分片，全部走同源代理。
function absUrl(u, base) {
  try {
    return new URL(u, base).href;
  } catch (_) {
    return u;
  }
}

function rewriteM3u8(text, baseUrl, proxyBase) {
  const toProxy = (u) => `${proxyBase}/api/proxy?url=${encodeURIComponent(absUrl(u, baseUrl))}`;
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out.push(raw);
      continue;
    }
    if (line.startsWith("#")) {
      // #EXT-X-KEY / #EXT-X-MAP / #EXT-X-MEDIA 等标签里的 URI="..."
      out.push(raw.replace(/URI="([^"]*)"/g, (_m, u) => `URI="${toProxy(u)}"`));
      continue;
    }
    out.push(toProxy(line));
  }
  return out.join("\n");
}

async function handleProxy(req, res, url) {
  const target = url.searchParams.get("url");
  if (!target) return sendJson(res, 400, { error: "缺少 url 参数" });
  let u;
  try {
    u = new URL(target);
  } catch (_) {
    return sendJson(res, 400, { error: "url 非法" });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return sendJson(res, 400, { error: "仅支持 http / https" });

  const headers = {
    "user-agent": url.searchParams.get("ua") || req.headers["user-agent"] || DEFAULT_UA,
    accept: req.headers["accept"] || "*/*",
    "accept-language": "zh-CN,zh;q=0.9",
  };
  const ref = url.searchParams.get("ref");
  if (ref) headers.referer = ref;
  if (req.headers.range) headers.range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(u.href, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return sendJson(res, 502, { error: "上游抓取失败：" + (e?.message || e) });
  }

  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  const looksM3u8 = ct.includes("mpegurl") || /\.m3u8(\?|#|$)/i.test(u.href);

  // m3u8 播放列表：重写为同源代理地址后返回文本
  if (looksM3u8) {
    let text = "";
    try {
      text = await upstream.text();
    } catch (_) {
      /* 落到下面按二进制流处理 */
    }
    if (text) {
      const host = req.headers.host || `127.0.0.1:${PORT}`;
      const proxyBase = `http://${host}`;
      const rewritten = rewriteM3u8(text, u.href, proxyBase);
      res.writeHead(200, {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(rewritten);
      return;
    }
  }

  const out = {
    "Content-Type": ct || "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    "Cache-Control": "no-store",
  };
  const cl = upstream.headers.get("content-length");
  if (cl) out["Content-Length"] = cl;
  const cr = upstream.headers.get("content-range");
  if (cr) out["Content-Range"] = cr;

  res.writeHead(upstream.status, out);
  if (!upstream.body) {
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (_) {
    try {
      res.destroy();
    } catch (_) {}
  }
}

// ============================================================================
// API 路由
// ============================================================================

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (p === "/api/sources")
      return sendJson(
        res,
        200,
        {
          default: DEFAULT_SOURCE,
          sources: Object.values(SOURCES).map((s) => ({
            id: s.id,
            name: s.name,
            desc: s.desc,
            limited: s.limited,
          })),
        }
      );

    const srcName = url.searchParams.get("source") || DEFAULT_SOURCE;
    const src = resolveSource(srcName);

    if (p === "/api/home")
      return sendJson(res, 200, await cached(`home:${src.id}`, () => src.home()));
    if (p === "/api/search") {
      const q = url.searchParams.get("q") || "";
      return sendJson(res, 200, await cached(`search:${src.id}:${q}`, () => src.search(q)));
    }
    if (p === "/api/detail") {
      const id = url.searchParams.get("id") || "";
      return sendJson(res, 200, await cached(`detail:${src.id}:${id}`, () => src.detail(id)));
    }
    if (p === "/api/play") {
      const episodeId = url.searchParams.get("episodeId") || "";
      const data = await src.play(episodeId);
      return sendJson(res, 200, data);
    }
    sendJson(res, 404, { error: "unknown api" });
  } catch (e) {
    const code = e?.code === "COOLDOWN" ? 503 : e?.code === "NOT_FOUND" ? 404 : 502;
    console.error("[API ERROR]", url.pathname, e?.message || e);
    sendJson(res, code, { error: String(e?.message || e), code: e?.code || "UNKNOWN" });
  }
}

// ============================================================================
// 静态托管
// ============================================================================
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
  if (url.pathname === "/api/proxy") return handleProxy(req, res, url);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Short Drama Hub 播放器已启动: http://127.0.0.1:${PORT}`);
  console.log(`内容源: ${Object.values(SOURCES).map((s) => s.name).join(" / ")}`);
  console.log(`代理:   http://127.0.0.1:${PORT}/api/proxy?url=...  (自定义源 / 本地源稳定播放)`);
});
