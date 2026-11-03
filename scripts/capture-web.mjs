// scripts/capture-web.mjs
//
// 抓取任意网页的真实网络请求（CDP 驱动本机 Chrome），用于对比不同端的请求差异。
//
// 用法：node scripts/capture-web.mjs <url> [关键字过滤]
//   node scripts/capture-web.mjs https://www.hongguoduanju.com/ fqnovel
//   node scripts/capture-web.mjs https://fanqienovel.com/ video_model
//
// 输出：每个命中请求的 method / url / 关键请求头 / 状态 / 响应长度

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const URL_ = process.argv[2] || "https://www.hongguoduanju.com/";
const FILTER = process.argv[3] || "";
const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.CDP_PORT) || 9334;
const WAIT_MS = Number(process.env.WAIT_MS) || 12000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) this.events.push(msg);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("CDP timeout: " + method));
        }
      }, 90000);
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return r.result?.value;
  }
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdh-cap-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    "--disable-gpu",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" }
);

let cdp;
try {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch (_) {}
    if (!wsUrl) await sleep(300);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  cdp = new CDP(ws);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  console.log(`▶ 打开 ${URL_}`);
  await cdp.send("Page.navigate", { url: URL_ });
  await sleep(WAIT_MS);

  // 尝试自动点击第一个「短剧/播放」入口，触发播放接口
  const clicked = await cdp.evaluate(`(() => {
    const sels = ['.play-btn','[class*="play"]','[class*="Play"]','a[href*="play"]','[class*="detail"]'];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el) { el.click(); return 'clicked ' + s; }
    }
    const cards = document.querySelectorAll('a,div[class*="card"],div[class*="item"]');
    if (cards.length > 2) { cards[2].click(); return 'clicked card'; }
    return 'nothing';
  })()`);
  console.log("自动点击:", clicked);
  await sleep(WAIT_MS);

  const reqs = cdp.events.filter((e) => e.method === "Network.requestWillBeSent");
  const respMap = new Map();
  for (const e of cdp.events)
    if (e.method === "Network.responseReceived")
      respMap.set(e.params.requestId, e.params.response);

  const interesting = reqs.filter((e) => {
    const u = e.params.request.url;
    if (!/^https?:/.test(u)) return false;
    if (!FILTER) return !/\.(png|jpg|jpeg|gif|webp|svg|css|woff2?|ttf|ico)(\?|$)/i.test(u);
    return u.includes(FILTER);
  });

  // 主机汇总
  const hosts = {};
  for (const e of reqs) {
    const u = new URL(e.params.request.url);
    hosts[u.host] = (hosts[u.host] || 0) + 1;
  }
  console.log("\n=== 主机分布 ===");
  for (const [h, n] of Object.entries(hosts).sort((a, b) => b[1] - a[1])) console.log("  " + n + "  " + h);

  // 所有非静态资源的请求
  const apiLike = reqs.filter((e) => {
    const u = e.params.request.url;
    if (!/^https?:/.test(u)) return false;
    if (/\.(js|css|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico|mp4)(\?|$)/i.test(u)) return false;
    return true;
  });
  console.log("\n=== 疑似接口请求 " + apiLike.length + " 条 ===");
  for (const e of apiLike) {
    const r = e.params.request;
    const resp = respMap.get(e.params.requestId);
    console.log("\n[" + r.method + "] " + r.url.slice(0, 260));
    console.log("    status=" + (resp?.status ?? "-") + "  type=" + (resp?.mimeType ?? "-"));
    const h = r.headers || {};
    for (const k of Object.keys(h)) {
      if (/^(x-gorgon|x-argus|x-ladon|x-helios|x-medusa|x-ss-stub|x-reading-request|x-xs-from-web|x-msdk-params|cookie|user-agent|referer|msToken|x-bogus|a_bogus)$/i.test(k)) {
        let v = String(h[k]);
        if (v.length > 70) v = v.slice(0, 70) + "…";
        console.log("    > " + k + ": " + v);
      }
    }
  }

  console.log(`\n=== 命中请求 ${interesting.length} 条 / 总请求 ${reqs.length} 条 ===`);
  for (const e of interesting) {
    const r = e.params.request;
    const resp = respMap.get(e.params.requestId);
    console.log(`\n[${r.method}] ${r.url.slice(0, 220)}`);
    console.log(`    status=${resp?.status ?? "-"}  type=${resp?.mimeType ?? "-"}`);
    const h = r.headers || {};
    for (const k of Object.keys(h)) {
      if (/^(x-gorgon|x-argus|x-ladon|x-helios|x-medusa|x-ss-stub|x-reading-request|cookie|user-agent|x-xs-from-web|x-khronos|x-ss-req-ticket|x-ss-dp|referer|sec-fetch-site|origin)$/i.test(k)) {
        let v = String(h[k]);
        if (k.length > 24) v = v.slice(0, 60) + "…";
        console.log(`    > ${k}: ${v}`);
      }
    }
  }
} catch (e) {
  console.error("抓取失败:", e.message);
} finally {
  try { chrome.kill(); } catch (_) {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
}
