// server/proxy.js
//
// 可选的本地服务 / 只读接口模块。零第三方依赖（仅用 Node 内置模块）。
//
// 它做两件事：
//   1. 静态托管本项目的 index.html 与 assets（让你用 `node server/proxy.js` 即可起服务，无需 Python）。
//   2. 暴露两个【只读】接口，仅做 URL 拼接，绝不向外部发起请求、绝不解析视频流：
//        GET /api/platforms        -> 返回平台配置数组（JSON）
//        GET /api/search?q=关键词   -> 返回各平台的官方搜索链接（JSON）
//
// 纯前端模式（直接用浏览器打开 / python -m http.server）并不依赖本文件；
// 本文件是为想用 Node 托管、或将来要接入真实元数据的开发者准备的扩展点。

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.PORT || 8788;

// 平台数据：直接从前端共享的 platforms.js 读取并内联导出（保持单一数据源）
const PLATFORMS_FILE = path.join(ROOT, "assets/js/platforms.js");

function loadPlatforms() {
  const src = fs.readFileSync(PLATFORMS_FILE, "utf8");
  // 提取 `export const PLATFORMS = [ ... ];` 数组字面量
  const m = src.match(/export const PLATFORMS\s*=\s*(\[[\s\S]*?\n\];)/);
  if (!m) return [];
  // 用 Function 安全求值该数组字面量（仅本地配置，不包含任何外部输入）
  return Function(`"use strict"; return (${m[1].replace(/;\s*$/, "")})`)();
}

function buildSearchUrl(platform, query) {
  const q = encodeURIComponent(query.trim());
  if (platform.search && platform.search.includes("{q}")) {
    return platform.search.replace("{q}", q);
  }
  let host = "";
  try {
    host = new URL(platform.home).hostname;
  } catch (_) {
    host = "";
  }
  const site = host ? `%20site:${host}` : "";
  return `https://www.bing.com/search?q=${q}${site}`;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // 只读接口
  if (p === "/api/platforms" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(loadPlatforms(), null, 2));
    return;
  }
  if (p === "/api/search" && req.method === "GET") {
    const q = url.searchParams.get("q") || "";
    const list = loadPlatforms().map((pl) => ({
      id: pl.id,
      name: pl.name,
      type: pl.type,
      url: q ? buildSearchUrl(pl, q) : pl.home,
    }));
    res.writeHead(200, { "Content-Type": MIME[".json"], "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ query: q, results: list }, null, 2));
    return;
  }

  // 静态托管
  let filePath = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Short Drama Hub 本地服务已启动: http://127.0.0.1:${PORT}`);
  console.log(`只读接口: /api/platforms  /api/search?q=关键词`);
});
