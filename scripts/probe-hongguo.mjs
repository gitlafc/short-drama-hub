// scripts/probe-hongguo.mjs
//
// 实证工具：hook Node 的 fetch，完整打印 openhongguo 发出的真实 HTTP 请求
// （URL / method / headers / body 摘要），用于分析红果接口的鉴权方式。
//
// 用法：node scripts/probe-hongguo.mjs [play|search|detail]

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const realFetch = globalThis.fetch;
const log = [];

// ---- hook node:https / node:http（SDK 走的是原生 http 模块，不是 fetch）----
const httpMod = await import("node:http");
const httpsMod = await import("node:https");

function hook(mod, label) {
  // ESM 命名空间只读，改 default（CJS 导出对象）上的属性，SDK 拿到的正是同一个对象
  const target = mod.default ?? mod;
  const orig = target.request;
  target.request = function (...args) {
    const [url, opts, cb] = args;
    const u = typeof url === "string" ? url : url?.href || url?.path;
    const options = (opts && typeof opts === "object" && !Array.isArray(opts)) ? opts : (typeof url === "object" ? url : {});
    const rec = {
      url: u,
      method: options.method || "GET",
      headers: { ...(options.headers || {}) },
      body: "",
      via: label,
    };
    log.push(rec);
    const req = orig.apply(this, args);
    const origWrite = req.write.bind(req);
    req.write = (chunk, ...rest) => {
      if (typeof chunk === "string") rec.body += chunk;
      else if (chunk && typeof chunk.byteLength === "number") {
        rec.body += "[binary " + chunk.byteLength + "B]";
        rec.bodyBuf = rec.bodyBuf ? Buffer.concat([rec.bodyBuf, Buffer.from(chunk)]) : Buffer.from(chunk);
      }
      return origWrite(chunk, ...rest);
    };
    req.on("response", (res) => {
      rec.status = res.statusCode;
      rec.resHeaders = { ...res.headers };
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        rec.resLen = buf.length;
        // 可能是 gzip / protobuf，尝试多种解码
        let preview = buf.slice(0, 800).toString("utf8");
        if (/[\x00-\x08\x0e-\x1f]/.test(preview)) {
          preview = "[非文本二进制] hex=" + buf.slice(0, 160).toString("hex");
        }
        try {
          if (res.headers["content-encoding"] === "gzip" || buf[0] === 0x1f) {
            preview = zlib.gunzipSync(buf).slice(0, 800).toString("utf8");
          }
        } catch (_) {}
        rec.resBody = preview;
      });
    });
    return req;
  };
}
hook(httpsMod, "https");
hook(httpMod, "http");

globalThis.fetch = async function (input, init = {}) {
  const url = typeof input === "string" ? input : input?.url;
  const method = init.method || "GET";
  const headers = {};
  const h = init.headers || {};
  if (h.forEach) h.forEach((v, k) => (headers[k] = v));
  else Object.assign(headers, h);
  const rec = { url, method, headers, body: String(init.body || ""), via: "fetch" };
  log.push(rec);
  const res = await realFetch(input, init);
  rec.status = res.status;
  return res;
};

const { createClient, fileProfileStore } = await import("openhongguo");
const mode = process.argv[2] || "play";

// 用一份全新设备档案，避免和线上的持久档案互相干扰
const profilePath = path.join(ROOT, ".openhongguo-profile.json");
const existed = fs.existsSync(profilePath);
const backup = existed ? fs.readFileSync(profilePath, "utf8") : null;

const client = await createClient({
  profile: fileProfileStore(profilePath),
  retryAttempts: 1,
});

try {
  if (mode === "search") {
    const r = await client.search("总裁");
    console.log("搜索结果数:", r.items?.length, "|", r.items?.[0]?.title);
  } else if (mode === "detail") {
    const r = await client.search("总裁");
    const d = await client.getSeries(r.items[0].id);
    console.log("详情:", d.title, "| 集数:", d.episode_count);
  } else {
    const r = await client.search("总裁");
    const eps = await client.listEpisodes(r.items[0].id);
    console.log("分集数:", eps.items?.length);
    try {
      const pb = await client.resolvePlayback(eps.items[0].id);
      console.log(
        "✅ 播放解析成功:",
        pb.streams?.map((s) => s.definition + " → " + String(s.url).slice(0, 110))
      );
    } catch (e) {
      console.log("❌ 播放解析失败:", e.code, "|", e.message);
      console.log("   retryable:", e.retryable, "| retryAfterMs:", e.retryAfterMs);
    }
  }
} catch (e) {
  console.log("执行失败:", e.code, "|", e.message);
}

// 还原设备档案
if (!existed) {
  try {
    fs.rmSync(profilePath);
  } catch (_) {}
} else if (backup) {
  fs.writeFileSync(profilePath, backup);
}

console.log("\n=== 请求明细 (" + log.length + " 条) ===");
for (const [i, r] of log.entries()) {
  console.log(`\n[${i}] ${r.method} ${r.url}`);
  console.log(`    status=${r.status ?? "-"}${r.error ? "  err=" + r.error : ""}`);
  if (r.resLen !== undefined) console.log(`    respLen=${r.resLen}`);
  for (const [k, v] of Object.entries(r.headers)) {
    let s = String(v);
    if (k.toLowerCase() === "cookie") s = s.slice(0, 200) + "…";
    console.log(`    > ${k}: ${s.slice(0, 240)}`);
  }
  if (r.body) console.log(`    > body: ${r.body}`);
  if (r.resBody) console.log(`    < body: ${r.resBody}`);
  if (r.bodyBuf) {
    const out = path.join(ROOT, ".probe-req-" + i + ".bin");
    fs.writeFileSync(out, r.bodyBuf);
    console.log(`    > body 已存: ${out} (${r.bodyBuf.length}B) b64=${r.bodyBuf.toString("base64").slice(0, 120)}`);
  }
}
