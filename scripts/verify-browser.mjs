// scripts/verify-browser.mjs
//
// 真实浏览器端到端自检：用 CDP 驱动本机 Chrome（headless）打开播放器，
// 验证「自定义源 m3u8 播放」「本地片库源」「内容源切换」「hls.js 加载」等关键链路。
//
// 用法：
//   node server/index.js &            # 先启动服务
//   node scripts/verify-browser.mjs   # 再跑自检
//
// 环境变量：
//   APP_URL   默认 http://127.0.0.1:8788/
//   CHROME    默认 C:\Program Files\Google\Chrome\Application\chrome.exe
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const APP = process.env.APP_URL || "http://127.0.0.1:8788/";
const CHROME =
  process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.CDP_PORT) || 9333;

const TEST_M3U8 = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- CDP 客户端 ----------
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
      } else if (msg.method) {
        this.events.push(msg);
      }
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
      }, 120000);
    });
  }
  async evaluate(expression, awaitPromise = true) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error("无法连接 Chrome 调试端口");
}

// ---------- 断言 ----------
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  —— " + detail : ""}`);
}

// ---------- 主流程 ----------
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdh-cdp-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" }
);

let cdp;
try {
  const wsUrl = await getTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  cdp = new CDP(ws);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  console.log(`\n▶ 打开 ${APP}`);
  await cdp.send("Page.navigate", { url: APP });
  await sleep(1200);

  // 等待剧库出卡片（最多 20s，红果源首访需加载 wasm）
  let ui = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    ui = await cdp.evaluate(`(() => ({
      hls: typeof window.Hls !== 'undefined' && !!window.Hls.isSupported,
      navs: [...document.querySelectorAll('.nav button')].map(b => b.textContent.trim()),
      hasCustom: !!document.getElementById('view-custom'),
      srcOpts: [...document.querySelectorAll('#sourceSel option')].map(o => o.value),
      cards: document.querySelectorAll('#grid .card').length,
      empty: (document.getElementById('homeEmpty')||{}).textContent || '',
    }))()`);
    if (ui.cards > 0) break;
  }
  check("hls.js 已加载且可用", ui.hls);
  check("导航含「剧库/自定义源/我的」", ui.navs.length === 3, ui.navs.join(" / "));
  check("自定义源视图存在", ui.hasCustom);
  check("内容源下拉已填充", ui.srcOpts.includes("hongguo") && ui.srcOpts.includes("local"), ui.srcOpts.join(","));
  check("剧库加载到卡片", ui.cards > 0, ui.cards + " 张");

  // 2. 自定义源：粘贴 m3u8 → 播放
  console.log(`\n▶ 自定义源播放：${TEST_M3U8}`);
  await cdp.evaluate(`(() => {
    document.querySelector('.nav button[data-go="custom"]').click();
    document.getElementById('cusTitle').value = '自检流';
    document.getElementById('cusUrls').value = ${JSON.stringify(TEST_M3U8)};
    document.getElementById('cusProxy').checked = true;
    document.getElementById('cusPlay').click();
    return true;
  })()`);

  let play = { t: 0, rs: 0, err: "", eps: 0 };
  for (let i = 0; i < 24; i++) {
    await sleep(1000);
    play = await cdp.evaluate(`(() => {
      const v = document.getElementById('video');
      return {
        t: v ? v.currentTime : 0,
        rs: v ? v.readyState : 0,
        dur: v ? (v.duration || 0) : 0,
        err: v && v.error ? (v.error.message || v.error.code) : '',
        eps: document.querySelectorAll('#pEpisodes .ep-btn').length,
        status: (document.getElementById('pStatus')||{}).textContent || '',
        view: !document.getElementById('view-player').hidden,
      };
    })()`);
    if (play.t > 0.5) break;
  }
  check("自定义源进入播放视图", play.view === true);
  check("自定义源解析出分集", play.eps >= 1, play.eps + " 集");
  check("m3u8 实际开始播放", play.t > 0.5, `currentTime=${play.t.toFixed(2)}s readyState=${play.rs}`);
  check("播放无错误", !play.err, play.err || "无");

  // 2b. 自定义源：JSON API 模式
  const apiUrl = new URL("/demo/api-list.json", APP).href;
  console.log(`\n▶ 自定义源 JSON API 模式：${apiUrl}`);
  await cdp.evaluate(`(() => {
    document.querySelector('.nav button[data-go="custom"]').click();
    document.getElementById('cusTitle').value = 'API 源';
    document.getElementById('cusMode').value = 'api';
    document.getElementById('cusUrls').value = ${JSON.stringify(apiUrl)};
    document.getElementById('cusProxy').checked = true;
    document.getElementById('cusPlay').click();
    return true;
  })()`);
  let apiPlay = { t: 0, eps: 0, msg: "" };
  for (let i = 0; i < 24; i++) {
    await sleep(1000);
    apiPlay = await cdp.evaluate(`(() => {
      const v = document.getElementById('video');
      return {
        t: v ? v.currentTime : 0,
        eps: document.querySelectorAll('#pEpisodes .ep-btn').length,
        msg: (document.getElementById('cusMsg')||{}).textContent || '',
      };
    })()`);
    if (apiPlay.t > 0.5) break;
  }
  check("JSON API 解析出 3 集", apiPlay.eps === 3, apiPlay.eps + " 集");
  check("JSON API 源开始播放", apiPlay.t > 0.5, `currentTime=${apiPlay.t.toFixed(2)}s · ${apiPlay.msg}`);

  // 3. 本地片库源
  console.log("\n▶ 切换到本地片库源");
  await cdp.evaluate(`(() => {
    document.querySelector('.nav button[data-go="home"]').click();
    const sel = document.getElementById('sourceSel');
    sel.value = 'local';
    sel.dispatchEvent(new Event('change'));
    return true;
  })()`);
  let local = { cards: 0, title: "" };
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    local = await cdp.evaluate(`(() => ({
      cards: document.querySelectorAll('#grid .card').length,
      title: (document.querySelector('#grid .card h3')||{}).textContent || '',
    }))()`);
    if (local.cards > 0) break;
  }
  check("本地片库源加载到内容", local.cards > 0, local.cards + " 张：" + local.title);

  // 4. 本地源详情 → 播放
  await cdp.evaluate(`(() => {
    const c = document.querySelector('#grid .card');
    if (c) c.click();
    return true;
  })()`);
  let epCount = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    epCount = await cdp.evaluate(`document.querySelectorAll('#dEpisodes .ep-btn').length`);
    if (epCount > 0) break;
  }
  check("本地源详情列出分集", epCount >= 1, epCount + " 集");

  await cdp.evaluate(`(() => {
    const b = document.querySelector('#dEpisodes .ep-btn');
    if (b) b.click();
    return true;
  })()`);
  let localPlay = { t: 0, rs: 0, err: "" };
  for (let i = 0; i < 24; i++) {
    await sleep(1000);
    localPlay = await cdp.evaluate(`(() => {
      const v = document.getElementById('video');
      return { t: v ? v.currentTime : 0, rs: v ? v.readyState : 0, err: v && v.error ? v.error.message : '' };
    })()`);
    if (localPlay.t > 0.5) break;
  }
  check("本地源 m3u8 开始播放", localPlay.t > 0.5, `currentTime=${localPlay.t.toFixed(2)}s readyState=${localPlay.rs}`);

  // 5. 控制台错误
  const errs = cdp.events
    .filter((e) => e.method === "Log.entryAdded" && e.params?.entry?.level === "error")
    .map((e) => e.params.entry.text)
    .filter((t) => !/favicon|ERR_BLOCKED_BY_CLIENT/i.test(t));
  const exceptions = cdp.events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params?.exceptionDetails?.exception?.description || e.params?.exceptionDetails?.text);
  check("无 JS 运行时异常", exceptions.length === 0, exceptions.slice(0, 2).join(" | "));
  check("无控制台错误", errs.length === 0, errs.slice(0, 2).join(" | "));
} catch (e) {
  check("自检脚本执行", false, e.message);
} finally {
  try {
    chrome.kill();
  } catch (_) {}
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (_) {}
}

const failed = results.filter((r) => !r.ok);
console.log(`\n──────── 自检结果：${results.length - failed.length}/${results.length} 通过 ────────`);
process.exit(failed.length ? 1 : 0);
