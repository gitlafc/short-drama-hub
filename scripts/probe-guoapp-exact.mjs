// 用 guoapp 逐字段一致的 payload 复测其 App 通道
import crypto from "node:crypto";

const HG_UA = "com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)";

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

const GORGON_KEY = Buffer.from([0x44,0xb9,0xb9,0xd9,0xa4,0xae,0xf9,0xfc,0xa4,0x93,0xaa,0x75,0x7c,0xa3,0xc2,0xc4,0xa4,0x96,0x93,0x8f]);
const rotl8 = (x, n) => ((x << n) | (x >>> (8 - n))) & 0xff;
const rev8 = (x) => { let r = 0; for (let i = 0; i < 8; i++) r = (r << 1) | ((x >> i) & 1); return r & 0xff; };

function signHongguo(rawQuery, bodyBuf, now) {
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
  headers["X-Gorgon"] = Buffer.concat([Buffer.from([0x84,0x04,0x40,0x1c,0,0]), payload]).toString("hex");
  headers["X-SS-Req-Ticket"] = String(now);
  return headers;
}

const newDeviceID = () => String(1_000_000_000_000_000_000n + (BigInt("0x" + crypto.randomBytes(8).toString("hex")) % 8_000_000_000_000_000_000n));

function build({ host, path: p, body, ua = HG_UA, queryExtra = {} }) {
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
    ...queryExtra,
  };
  q._rticket = String(now);
  const rawQuery = goEncodeQuery(q);
  const bodyBuf = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
  const headers = {
    "User-Agent": ua, Accept: "application/json",
    "X-XS-From-Web": "0", "Sdk-Version": "2",
    ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
  };
  Object.assign(headers, signHongguo(rawQuery, bodyBuf, now));
  return { url: `https://${host}${p}?${rawQuery}`, headers, bodyBuf };
}

async function shoot(label, spec) {
  const r = build(spec);
  try {
    const res = await fetch(r.url, { method: "POST", headers: r.headers, body: r.bodyBuf });
    const text = await res.text();
    let note = "";
    try {
      const j = JSON.parse(text);
      const vd = j?.data?.video_data;
      note = vd
        ? `★ data.video_data=${Array.isArray(vd) ? vd.length : "obj"} 项`
        : `code=${j.code} ${j.message || ""} 顶层键=${Object.keys(j).join(",")}`;
    } catch (_) { note = text.slice(0, 80).replace(/\s+/g, " "); }
    console.log(label.padEnd(40), "HTTP", res.status, "len=" + String(text.length).padEnd(7), note);
    return text;
  } catch (e) {
    console.log(label.padEnd(40), "ERR", e.message);
    return "";
  }
}

// guoapp 的 catalog payload（逐字段照抄）
const CATALOG_PAYLOAD = {
  req_scene: "default",
  offset: 0,
  limit: 18,
  req_type: "only_content",
  need_selector_panel: false,
  client_req_type: 3,
  session_id: "",
  filter_ids: "",
  select_items: {
    genre: ["short_play"],
    sort: ["online_time"],
    gender: [],
    category_dim_theme: [],
    category_dim_role: [],
    category_dim_epoch: [],
    online_time: [],
    creation_status: [],
  },
};

const HOSTS = ["api5-normal-sinfonlineb.fqnovel.com", "api5-normal-sinfonlinea.fqnovel.com"];

console.log("=== 1) catalog（逐字段照抄 guoapp payload）===");
for (const h of HOSTS) await shoot(`catalog @ ${h.slice(5, 22)}`, { host: h, path: "/reading/distribution/category/landpage/v/", body: CATALOG_PAYLOAD });

console.log("\n=== 2) video_detail（guoapp payload）===");
for (const h of HOSTS) await shoot(`detail  @ ${h.slice(5, 22)}`, { host: h, path: "/novel/player/video_detail/v1/", body: { series_id: "7701935931787316286" } });

console.log("\n=== 3) video_model（guoapp payload，video_platform=3）===");
for (const h of HOSTS)
  await shoot(`model   @ ${h.slice(5, 22)}`, {
    host: h, path: "/novel/player/video_model/v1/",
    body: { video_id: "7701937936731737112", content_type: 1, biz_param: { need_all_video_definition: true, video_platform: 3 } },
  });

console.log("\n=== 4) 搜索建议（真果鉴有 /incent_resource/suggestion）===");
await shoot("suggestion", {
  host: "hongguoduanju.com", path: "/incent_resource/suggestion",
  body: { keyword: "总裁" },
  queryExtra: {},
});
