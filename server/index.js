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

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "openhongguo";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8788;

// openhongguo 的 createClient 需要加载 wasm，较重；复用单例，避免每个请求重建。
let _client = null;
function getClient() {
  if (!_client) _client = createClient();
  return _client;
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
  });
  res.end(JSON.stringify(obj));
}

// ---------- 内容源接口 ----------

async function apiHome(res) {
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
  sendJson(res, 200, { hot: hotItems, newReleases: newItems, categories: tabs });
}

async function apiSearch(res, q) {
  const c = await getClient();
  const r = await c.search(q);
  const items = (r.items || []).map((x) => ({
    id: x.id,
    title: x.title,
    description: x.description || "",
    episode_count: x.episode_count || 0,
    type: x.content_type,
  }));
  sendJson(res, 200, { items, has_more: !!r.has_more });
}

async function apiDetail(res, id) {
  const c = await getClient();
  const [series, eps, rec] = await Promise.all([
    c.getSeries(id),
    c.listEpisodes(id),
    c.seriesRecommend(id).catch(() => ({ items: [] })),
  ]);
  // 详情封面优先用第一集封面（.image 格式，浏览器可显示），回退到剧集封面（HEIC）。
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
  sendJson(res, 200, {
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
  });
}

async function apiPlay(res, episodeId) {
  const c = await getClient();
  // 红果匿名接口存在设备级限额（ANONYMOUS_LIMITED），resolvePlayback 偶发返回空。
  // 策略：失败后重置匿名设备并重试一次；仍失败则返回可理解的提示。
  let pb = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      pb = await c.resolvePlayback(episodeId);
      if (pb && pb.streams && pb.streams.length) break;
    } catch (e) {
      console.warn("[play] attempt", attempt, "resolve failed:", e?.message);
    }
    try {
      await c.resetDevice();
    } catch (_) {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!pb || !pb.streams || !pb.streams.length) {
    return sendJson(res, 502, {
      error: "源暂时受限（匿名设备限额），请稍后重试或更换剧集。",
    });
  }
  const streams = pb.streams
    .slice()
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  const best = streams[0];
  sendJson(res, 200, {
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

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (p === "/api/home") return await apiHome(res);
    if (p === "/api/search")
      return await apiSearch(res, url.searchParams.get("q") || "");
    if (p === "/api/detail")
      return await apiDetail(res, url.searchParams.get("id") || "");
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
