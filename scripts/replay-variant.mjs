// scripts/replay-variant.mjs
//
// 实证工具：捕获 openhongguo 发出的 video_model 请求，然后原样重放并逐个变参，
// 观察哪些参数画像能让服务端返回非空（这是红果「PC 版 vs 匿名版」差异的定位手段）。
//
// 用法：node scripts/replay-variant.mjs

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------- 1. 捕获 SDK 的 video_model 请求 ----------
const origRequest = https.request;
let captured = null;
let capturedDetail = null;

https.request = function (url, opts, cb) {
  const u = typeof url === "string" ? url : url?.href;
  const options = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : (typeof url === "object" ? url : {});
  if (u?.includes("/novel/player/video_model/")) {
    captured = { url: u, method: options.method || "GET", headers: options.headers || {}, body: null };
  }
  if (u?.includes("/novel/player/video_detail/")) {
    capturedDetail = { url: u, method: options.method || "GET", headers: options.headers || {}, body: null };
  }
  const req = origRequest.apply(this, arguments);
  const origWrite = req.write.bind(req);
  req.write = (chunk, ...rest) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (captured && !captured.body && chunk) captured.body = buf;
    if (capturedDetail && !capturedDetail.body && chunk) capturedDetail.body = buf;
    return origWrite(chunk, ...rest);
  };
  return req;
};

const { createClient, fileProfileStore } = await import("openhongguo");
const client = await createClient({
  profile: fileProfileStore(path.join(ROOT, ".openhongguo-profile.json")),
  retryAttempts: 1,
});

try {
  const r = await client.search("总裁");
  const eps = await client.listEpisodes(r.items[0].id);
  await client.resolvePlayback(eps.items[0].id).catch(() => {});
} catch (_) {}

if (!captured) {
  console.error("未捕获到 video_model 请求");
  process.exit(1);
}

const BASE_URL = captured.url;
const BASE_BODY = JSON.parse(captured.body.toString("utf8"));
console.log("基准 URL 长度:", BASE_URL.length);
console.log("基准 body:", JSON.stringify(BASE_BODY));
console.log("");

// ---------- 2. 重放工具 ----------
function replay(url, bodyObj, extraHeaders = {}) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(bodyObj));
    const u = new URL(url);
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(body.length),
      ...extraHeaders,
    };
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: captured.method,
        headers,
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, len: buf.length, body: buf.toString("utf8").slice(0, 300) });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: "TIMEOUT", len: 0, body: "" });
    });
    req.on("error", (e) => resolve({ status: "ERR", len: 0, body: String(e.message) }));
    req.write(body);
    req.end();
  });
}

function setParams(url, overrides) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  }
  return u.href;
}

function setBody(body, overrides) {
  const b = JSON.parse(JSON.stringify(body));
  for (const [k, v] of Object.entries(overrides)) {
    const parts = k.split(".");
    let o = b;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= {};
    o[parts[parts.length - 1]] = v;
  }
  return b;
}

// ---------- 3. 变体矩阵 ----------
const rnd = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const NEW_IID = rnd(15);
const NEW_DID = rnd(15);
const NEW_UDID = rnd(16);

const variants = [
  { name: "① 基线（原样）", url: {}, body: {}, headers: {} },
  { name: "② user_is_login=1", url: { user_is_login: "1" }, body: {}, headers: {} },
  { name: "③ PC 画像 platform=web/os=web", url: { device_platform: "web", os: "web" }, body: {}, headers: {} },
  { name: "④ PC 画像 platform=pc/os=windows", url: { device_platform: "pc", os: "windows" }, body: {}, headers: {} },
  { name: "⑤ app_name=hongguo", url: { app_name: "hongguo" }, body: {}, headers: {} },
  { name: "⑥ aid 换 8664", url: { aid: "8664" }, body: {}, headers: {} },
  { name: "⑦ 去掉 dragon_device_type", url: { dragon_device_type: null }, body: {}, headers: {} },
  { name: "⑧ PC UA + Referer", url: {}, body: {}, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", referer: "https://fanqienovel.com/" } },
  { name: "⑨ body video_platform=0", url: {}, body: { "biz_param.video_platform": 0 }, headers: {} },
  { name: "⑩ body video_platform=1", url: {}, body: { "biz_param.video_platform": 1 }, headers: {} },
  { name: "⑪ body video_platform=2", url: {}, body: { "biz_param.video_platform": 2 }, headers: {} },
  { name: "⑫ body video_platform=4", url: {}, body: { "biz_param.video_platform": 4 }, headers: {} },
  { name: "⑬ body video_id_type=1", url: {}, body: { "biz_param.video_id_type": 1 }, headers: {} },
  { name: "⑭ need_all_video_definition=false", url: {}, body: { "biz_param.need_all_video_definition": false }, headers: {} },
  // ---- 决定性维度：设备身份 / 主机 / aid 组合 ----
  { name: "⑮ 全新 iid+device_id+openudid", url: { iid: NEW_IID, device_id: NEW_DID, openudid: NEW_UDID, cdid: rnd(8) + "-4e5d-4e5d-b67e-" + rnd(12) }, body: {}, headers: {} },
  { name: "⑯ 全新设备 + user_is_login=1", url: { iid: NEW_IID, device_id: NEW_DID, openudid: NEW_UDID, user_is_login: "1" }, body: {}, headers: {} },
  { name: "⑰ host→api-normal(无5)", url: { __host: "api-normal-sinfonlinea.fqnovel.com" }, body: {}, headers: {} },
  { name: "⑱ host→fqnovel.com", url: { __host: "fqnovel.com" }, body: {}, headers: {} },
  { name: "⑲ host→api5-ttbd", url: { __host: "api5-normal-sinfonlineb.fqnovel.com" }, body: {}, headers: {} },
  { name: "⑳ aid/app_name 组合 8670", url: { aid: "8670", app_name: "hongguo", channel: "hongguo_8670_64" }, body: {}, headers: {} },
  { name: "㉑ 全新的+PC画像+UA", url: { iid: rnd(15), device_id: rnd(15), openudid: rnd(16), device_platform: "web", os: "web" }, body: {}, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36" } },
  { name: "㉒ 带空 sessionid cookie", url: {}, body: {}, headers: { cookie: "sessionid=; sessionid_ss=; sid_tt=; uid_tt=; passport_csrf_token=" } },
];

console.log("=== 变体扫描（video_model）===");
console.log("变体".padEnd(36), "状态".padEnd(10), "长度".padEnd(8), "响应摘要");
console.log("-".repeat(100));

for (const v of variants) {
  const overrides = { ...v.url };
  let host = null;
  if (overrides.__host) {
    host = overrides.__host;
    delete overrides.__host;
  }
  let url = setParams(BASE_URL, overrides);
  if (host) url = url.replace(/^https:\/\/[^/]+/, "https://" + host);
  const body = setBody(BASE_BODY, v.body);
  const res = await replay(url, body, v.headers);
  const flag = res.len > 0 ? " ★有数据★" : "";
  console.log(
    v.name.padEnd(34),
    String(res.status).padEnd(8),
    String(res.len).padEnd(8),
    (res.body || "").replace(/\s+/g, " ").slice(0, 60) + flag
  );
}

// ---------- 4. 对照组：video_detail 在同样变体下是否仍有数据 ----------
console.log("\n=== 对照组：video_detail 是否也被拦 ===");
const detailBody = capturedDetail ? JSON.parse(capturedDetail.body.toString("utf8")) : null;
for (const v of [
  { name: "基线", url: {} },
  { name: "全新设备身份", url: { iid: rnd(15), device_id: rnd(15), openudid: rnd(16) } },
  { name: "PC 画像+UA", url: { device_platform: "web", os: "web" }, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36" } },
]) {
  const url = setParams(capturedDetail.url, v.url);
  const res = await replay(url, detailBody, v.headers || {});
  console.log(v.name.padEnd(20), String(res.status).padEnd(8), String(res.len).padEnd(8), (res.body || "").replace(/\s+/g, " ").slice(0, 60));
}
