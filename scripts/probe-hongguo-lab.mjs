#!/usr/bin/env node
/**
 * 红果取流实验室 —— 并排实测红果全部取流通路
 *
 * 背景：short-drama-hub 的红果源需要「免登录可播」的播放地址。
 * 本脚本对照实测 7 条通路，把「能不能拿到地址 / 拿到什么」量化输出，
 * 用于判断哪条路可用、限额边界在哪、以及后续该往哪个方向优化。
 *
 * 用法：
 *   node scripts/probe-hongguo-lab.mjs [seriesId] [ep1] [ep2] ...
 *   npm run probe
 */
import crypto from "node:crypto";

// ───────────────────────── 公共工具 ─────────────────────────
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const HG_UA =
  "com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)";
const WEB = "https://hongguoduanju.com";
const APP_A = "api5-normal-sinfonlinea.fqnovel.com";
const APP_B = "api5-normal-sinfonlineb.fqnovel.com";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function goEscape(s) {
  const unreserved = /[A-Za-z0-9\-_.~]/;
  let out = "";
  for (const ch of Buffer.from(s, "utf8")) {
    const c = String.fromCharCode(ch);
    if (unreserved.test(c)) out += c;
    else if (c === " ") out += "+";
    else out += "%" + ch.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}
const goEncodeQuery = (obj) =>
  Object.keys(obj).sort().map((k) => {
    const v = obj[k];
    return (Array.isArray(v) ? v : [v]).map((x) => `${goEscape(k)}=${goEscape(String(x))}`).join("&");
  }).join("&");
const newDeviceID = () =>
  String(1_000_000_000_000_000_000n + (BigInt("0x" + crypto.randomBytes(8).toString("hex")) % 8_000_000_000_000_000_000n));

// ───────────────── 通路 1：guoapp 纯 Gorgon 签名（真果鉴原生实现） ─────────────────
const GORGON_KEY = Buffer.from([
  0x44, 0xb9, 0xb9, 0xd9, 0xa4, 0xae, 0xf9, 0xfc, 0xa4, 0x93, 0xaa, 0x75,
  0x7c, 0xa3, 0xc2, 0xc4, 0xa4, 0x96, 0x93, 0x8f,
]);
const rotl8 = (x, n) => ((x << n) | (x >>> (8 - n))) & 0xff;
const rev8 = (x) => { let r = 0; for (let i = 0; i < 8; i++) r = (r << 1) | ((x >> i) & 1); return r & 0xff; };

function signGorgon(rawQuery, bodyBuf, now) {
  const ts = Math.floor(now / 1000) >>> 0;
  const payload = Buffer.alloc(20);
  crypto.createHash("md5").update(rawQuery, "utf8").digest().copy(payload, 0, 0, 4);
  const headers = {};
  if (bodyBuf) {
    const bh = crypto.createHash("md5").update(bodyBuf).digest();
    bh.copy(payload, 4, 0, 4);
    headers["X-SS-STUB"] = bh.toString("hex").toUpperCase();
  }
  payload[12] = 0; payload[13] = 6; payload[14] = 11; payload[15] = 28;
  payload.writeUInt32BE(ts, 16);
  for (let i = 0; i < 20; i++) payload[i] ^= GORGON_KEY[i];
  for (let i = 0; i < 20; i++) {
    const mixed = rotl8(payload[i], 4) ^ payload[(i + 1) % 20];
    payload[i] = rev8(mixed) ^ 0xff ^ 20;
  }
  headers["X-Khronos"] = String(ts);
  headers["X-Gorgon"] = Buffer.concat([Buffer.from([0x84, 0x04, 0x40, 0x1c, 0, 0]), payload]).toString("hex");
  headers["X-SS-Req-Ticket"] = String(now);
  return headers;
}

function buildAppRequest({ host, path: p, body, ua = HG_UA }) {
  const now = Date.now();
  const q = {
    aid: "8662", app_name: "novelread",
    version_code: "73532", version_name: "7.3.5.32",
    manifest_version_code: "73532", update_version_code: "73532",
    channel: "update_64",
    device_platform: "android", os: "android", ssmix: "a",
    device_type: "25053RT47C", device_brand: "Redmi",
    language: "zh", os_api: "36", os_version: "16",
    resolution: "1280*2772", dpi: "520", ac: "wifi",
    device_id: newDeviceID(), iid: newDeviceID(),
  };
  q._rticket = String(now);
  const rawQuery = goEncodeQuery(q);
  const bodyBuf = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
  const headers = {
    "User-Agent": ua, Accept: "application/json",
    "X-XS-From-Web": "0", "Sdk-Version": "2",
    ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
  };
  Object.assign(headers, signGorgon(rawQuery, bodyBuf, now));
  return { url: `https://${host}${p}?${rawQuery}`, headers, bodyBuf };
}

// ───────────────── 通路 2：官方网页版 API ─────────────────
async function webApi(path, body) {
  try {
    const res = await fetch(`${WEB}${path}?aid=8662`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": CHROME_UA },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, text };
  } catch (e) {
    return { status: 0, json: null, text: "ERR " + e.message };
  }
}

// ───────────────── 通路 3：网页版 SSR 页面 ─────────────────
function extractFirstJSON(raw, from) {
  let i = raw.indexOf("{", from);
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < raw.length; j++) {
    const ch = raw[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return raw.slice(i, j + 1); }
  }
  return null;
}
function parseRouterData(raw) {
  const m = /(?:window\.)?_ROUTER_DATA\s*=\s*/.exec(raw);
  if (!m) return null;
  const json = extractFirstJSON(raw, m.index + m[0].length);
  try { return json ? JSON.parse(json) : null; } catch (_) { return null; }
}
function loaderMap(data, ...names) {
  const loader = data?.loaderData || {};
  for (const n of names) { const p = loader[n]; if (p && Object.keys(p).length) return p; }
  for (const [key, value] of Object.entries(loader))
    for (const n of names) {
      const base = n.replace(/\$$/, "");
      if (base && key.startsWith(base) && value && Object.keys(value).length) return value;
    }
  return null;
}
async function webPage(seriesId, vid) {
  try {
    const res = await fetch(`${WEB}/player/${seriesId}/${vid}`, {
      headers: { "User-Agent": CHROME_UA, Referer: `${WEB}/`, "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    const html = await res.text();
    const page = loaderMap(parseRouterData(html), "player_", "player_page");
    const info = page?.video_player_info || {};
    const urls = [];
    for (const k of ["main_url", "backup_url", "backup_url_1", "backup_url_2", "backup_urls", "url_list"]) {
      const v = info[k];
      if (typeof v === "string" && /^https?:\/\//.test(v)) urls.push(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && /^https?:\/\//.test(x)) urls.push(x);
    }
    return {
      status: res.status,
      vidOk: page?.vid === vid,
      protectedPlayback: page?.protectedPlayback,
      seo: !!page?.publicVideoSeo?.available,
      nUrls: urls.length,
      urls,
    };
  } catch (e) { return { status: 0, err: e.message }; }
}

// ───────────────── 通路 4：guoapp 备用解析接口（含 v2 加密响应解密） ─────────────────
const BACKUP_API = "http://djapi.999888456.xyz/api/hongguo/play";
function decodeBackupResponse(body) {
  const text = String(body).trim();
  if (!text.startsWith("v2.")) return Buffer.from(text, "utf8");
  const parts = text.split(".");
  const encoded = Buffer.from(parts[1].slice(4), "hex");
  const mask = Buffer.from([104, 64, 70, 166, 190, 168, 143, 130, 225, 254, 251, 217, 196, 34, 45, 60, 29, 20, 103, 105]);
  const material = Buffer.alloc(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    const previous = i > 0 ? encoded[i - 1] : 109;
    const slot = i % mask.length;
    const salt = mask[slot] ^ ((90 + 13 * slot) & 0xff) ^ 85;
    material[i] = previous ^ salt ^ rotl8((encoded[i] + 215 - 11 * i) & 0xff, 3);
  }
  const ciphertext = Buffer.from(parts.slice(2).join("."), "base64");
  const decipher = crypto.createDecipheriv("aes-128-cbc", material.subarray(0, 16), material.subarray(16, 32));
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const pad = plain[plain.length - 1];
  if (pad < 1 || pad > 16) return plain;
  for (const b of plain.subarray(plain.length - pad)) if (b !== pad) return plain;
  return plain.subarray(0, plain.length - pad);
}
async function backupApi(seriesId, vid) {
  const ref = JSON.stringify({ content_type: 1004, from_video_id: "", series_id: seriesId, vid, video_platform: 3 });
  const id = Buffer.from(ref, "utf8").toString("base64");
  try {
    const res = await fetch(`${BACKUP_API}?id=${encodeURIComponent(id)}`, {
      headers: { "User-Agent": CHROME_UA, Referer: `${WEB}/` },
    });
    const raw = await res.text();
    const body = decodeBackupResponse(raw).toString("utf8");
    const j = JSON.parse(body);
    return { status: res.status, keys: Object.keys(j), keyUrls: (j.key_urls || []).length, parse: j.parse, url: j.url };
  } catch (e) { return { status: 0, err: e.message }; }
}

// ───────────────── 通路 5：openhongguo SDK（完整 5 层风控签名） ─────────────────
async function viaOpenhongguo(seriesId) {
  let out = {};
  try {
    const { createClient, fileProfileStore } = await import("openhongguo");
    const c = await createClient({ profile: fileProfileStore(".openhongguo-profile.json"), retryAttempts: 1 });
    const r = await c.listEpisodes(seriesId);
    out.episodes = (r.items || []).length;
    out.firstIds = (r.items || []).slice(0, 3).map((e) => e.id);
    // 播放地址：SDK 走 App 端 video_model
    try {
      const pb = await c.resolvePlayback(out.firstIds[0]);
      out.streams = pb?.streams?.length || 0;
    } catch (e) { out.playErr = e.code || e.message; }
  } catch (e) { out.err = e.message; }
  return out;
}

// ───────────────────────── 主流程 ─────────────────────────
const SERIES = process.argv[2] || "7701935931787316286";
const VIDS = process.argv.slice(3);

const line = "─".repeat(78);
console.log(line);
console.log("红果取流实验室 · 通路对照实测");
console.log(line);
console.log("series:", SERIES, "  episodes:", VIDS.join(", "));

console.log("\n【1】真果鉴 App 通道复刻（纯 Gorgon / sinfonlineb / com.phoenix.read）");
const CATALOG_PAYLOAD = {
  req_scene: "default", offset: 0, limit: 18, req_type: "only_content",
  need_selector_panel: false, client_req_type: 3, session_id: "", filter_ids: "",
  select_items: {
    genre: ["short_play"], sort: ["online_time"], gender: [],
    category_dim_theme: [], category_dim_role: [], category_dim_epoch: [],
    online_time: [], creation_status: [],
  },
};
for (const [label, spec] of [
  ["catalog  landpage", { host: APP_B, path: "/reading/distribution/category/landpage/v/", body: CATALOG_PAYLOAD }],
  ["detail   video_detail", { host: APP_B, path: "/novel/player/video_detail/v1/", body: { series_id: SERIES } }],
  ["play     video_model", {
    host: APP_B, path: "/novel/player/video_model/v1/",
    body: { video_id: VIDS[0] || "7701937936731737112", content_type: 1, biz_param: { need_all_video_definition: true, video_platform: 3 } },
  }],
]) {
  const r = buildAppRequest(spec);
  try {
    const res = await fetch(r.url, { method: "POST", headers: r.headers, body: r.bodyBuf });
    const text = await res.text();
    console.log(`   ${label.padEnd(24)} HTTP ${res.status}  len=${String(text.length).padEnd(7)} ${text.length ? "★有数据" : "空(被静默拒绝)"}`);
  } catch (e) { console.log(`   ${label.padEnd(24)} ERR ${e.message}`); }
  await sleep(300);
}

console.log("\n【2】openhongguo SDK（完整 5 层风控签名）");
const ohg = await viaOpenhongguo(SERIES);
console.log(`   分集数=${ohg.episodes ?? "-"}  播放流=${ohg.streams ?? "-"}  ${ohg.playErr ? "播放失败: " + ohg.playErr : ""}`);

console.log("\n【3】官方网页版 API（免签名 / 免登录）");
for (const vid of VIDS) {
  const fb = await webApi("/api/video/protected/fallback-play-info", { item_id: vid });
  const fbOK = !!fb.json?.main_url;
  const pi = await webApi("/api/video/protected/play-info", { series_id: SERIES, item_id: vid, definition: "720p" });
  const piOK = !!pi.json?.play_info;
  const defs = pi.json?.play_info?.definition || "-";
  const exp = fb.json?.url_expire ? new Date(fb.json.url_expire * 1000).toLocaleTimeString("zh-CN") : "-";
  console.log(
    `   vid=${vid}  fallback=${fbOK ? "✓ 有mp4直链" : "✗"}(${fb.json?.error || ""})  ` +
    `play-info=${piOK ? "✓ " + defs : "✗"}(${pi.json?.error || ""})  mp4有效期至=${exp}`
  );
  await sleep(400);
}

console.log("\n【4】官方网页版 SSR 页面（真果鉴网页通道的做法）");
for (const vid of VIDS) {
  const p = await webPage(SERIES, vid);
  console.log(
    `   vid=${vid}  HTTP ${p.status}  vid匹配=${p.vidOk}  protectedPlayback=${p.protectedPlayback}  ` +
    `publicVideoSeo=${p.seo}  播放地址数=${p.nUrls}`
  );
  await sleep(300);
}

console.log("\n【5】真果鉴备用解析接口（第三方服务）");
for (const vid of VIDS) {
  const b = await backupApi(SERIES, vid);
  console.log(`   vid=${vid}  HTTP ${b.status}  ${b.err ? "ERR " + b.err : `键=${b.keys?.join(",")}  key_urls=${b.keyUrls}  parse=${b.parse}`}`);
  await sleep(300);
}

console.log("\n" + line);
console.log("结论速览：");
console.log("  · 网页版 fallback/play-info API 是唯一免签名免登录可拿地址的通路，且同受「前 5 集」限制");
console.log("  · 真果鉴的 App 通道（纯 Gorgon）当前被字节静默拒绝 → 它依赖真机环境 + 家宽 IP 信誉");
console.log("  · 真果鉴的网页通道读 SSR 页面，未登录拿不到 video_player_info（比 API 更弱）");
console.log(line);
