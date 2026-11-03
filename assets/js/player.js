// player.js —— 视频播放器控制：加载播放地址、倍速、清晰度、进度记忆、自动连播
//
// 播放通道有三种：
//   1. 直连 mp4        —— 红果源返回的带签名临时直链
//   2. 本机代理 mp4    —— 自定义源 / 本地片库，绕开防盗链与 CORS
//   3. 本机代理 m3u8   —— 代理在服务端把播放列表重写为同源地址，hls.js 或原生 HLS 播放
import { api } from "./api.js";
import { store } from "./store.js";

let vEl = null;
let refs = {};
let current = null; // { series, episodes, index }
let hls = null; // hls.js 实例（m3u8 时存在）

const RATES = [1, 1.25, 1.5, 2];

export function isM3u8(url) {
  return /\.m3u8(\?|#|$)/i.test(url || "");
}

export function proxyUrl(url) {
  return "/api/proxy?url=" + encodeURIComponent(url);
}

export function bindPlayer(elements) {
  vEl = elements.video;
  refs = elements;

  vEl.addEventListener("timeupdate", () => {
    if (!current) return;
    const key = progKey(current);
    if (vEl.duration) store.setProg(key, vEl.currentTime, vEl.duration);
  });

  vEl.addEventListener("ended", () => {
    if (!current) return;
    if (current.index < current.episodes.length - 1) {
      openEpisode(current.series, current.episodes, current.index + 1);
    } else if (refs.status) {
      refs.status.textContent = "🎉 本剧已播完";
    }
  });

  vEl.addEventListener("error", () => {
    if (!current) return;
    const err = vEl.error;
    if (!err) return;
    if (refs.status && !refs.status.querySelector("button")) {
      refs.status.innerHTML = "";
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "⚠️ 播放失败（" + (err.message || "解码错误") + "），点击重试";
      btn.onclick = () => openEpisode(current.series, current.episodes, current.index);
      refs.status.appendChild(btn);
    }
  });
}

function progKey(c) {
  return `${c.series.id}:${c.episodes[c.index].id}`;
}

export function getCurrent() {
  return current;
}

// ---------- 挂载视频源 ----------
function destroyHls() {
  if (hls) {
    try {
      hls.destroy();
    } catch (_) {}
    hls = null;
  }
}

function attachSource(url, { proxy = false, m3u8 = false } = {}) {
  destroyHls();
  const src = proxy ? proxyUrl(url) : url;

  if (m3u8) {
    const Hls = window.Hls;
    const nativeOk = vEl.canPlayType("application/vnd.apple.mpegurl");
    // Safari / iOS 原生支持 HLS，直接给 <video> 即可
    if (nativeOk && (!Hls || !Hls.isSupported())) {
      vEl.src = src;
      return;
    }
    if (Hls && Hls.isSupported()) {
      const inst = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 60 });
      inst.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          inst.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          inst.recoverMediaError();
        } else {
          // 无法恢复：降级用原生 HLS 再试一次
          destroyHls();
          vEl.src = src;
          vEl.play().catch(() => {});
        }
      });
      inst.loadSource(src);
      inst.attachMedia(vEl);
      hls = inst;
      return;
    }
  }
  vEl.src = src;
}

export async function openEpisode(series, episodes, index) {
  if (!episodes || !episodes[index]) return;
  current = { series, episodes, index };
  const ep = episodes[index];
  if (refs.title) refs.title.textContent = `${series.title} · 第${ep.number}集`;
  if (refs.status) {
    refs.status.innerHTML = "";
    refs.status.textContent = "正在获取播放地址…";
  }

  try {
    let data;
    if (ep.direct) {
      // 自定义源：地址在前端已知，无需回源
      data = {
        url: ep.url,
        proxy: ep.proxy !== false,
        isM3u8: !!ep.isM3u8,
        streams: [
          { definition: ep.quality || "原画", url: ep.url, proxy: ep.proxy !== false, isM3u8: !!ep.isM3u8 },
        ],
      };
    } else {
      data = await api.play(ep.id, series.source);
    }
    if (!data || !data.url) throw new Error(data?.error || "未获取到播放地址");

    // 清晰度选项
    if (refs.quality) {
      refs.quality.innerHTML = "";
      (data.streams || []).forEach((s) => {
        const b = document.createElement("button");
        b.className = "quality-btn" + (s.url === data.url ? " on" : "");
        b.textContent = s.definition || "?";
        b.onclick = () => switchQuality(s.url, s.definition, s);
        refs.quality.appendChild(b);
      });
    }

    attachSource(data.url, {
      proxy: !!data.proxy,
      m3u8: !!data.isM3u8 || isM3u8(data.url),
    });

    const key = `${series.id}:${ep.id}`;
    const saved = store.getProg(key);
    vEl.onloadedmetadata = () => {
      if (saved && saved.d) vEl.currentTime = Math.min(saved.t, saved.d - 5);
    };
    await vEl.play().catch(() => {});
    if (refs.status) refs.status.innerHTML = "";

    store.addHis({
      id: series.id,
      title: series.title,
      cover: series.cover,
      ep: ep.id,
      epTitle: ep.title,
      source: series.source || "",
    });
    highlightEpisode(index);
  } catch (e) {
    if (refs.status) {
      refs.status.innerHTML = "";
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "⚠️ " + e.message + "（点击重试）";
      btn.onclick = () => openEpisode(series, episodes, index);
      refs.status.appendChild(btn);
    }
    destroyHls();
    vEl.removeAttribute("src");
    vEl.load();
  }
}

function switchQuality(url, def, stream) {
  const t = vEl.currentTime;
  attachSource(url, {
    proxy: !!(stream && stream.proxy),
    m3u8: !!(stream && stream.isM3u8) || isM3u8(url),
  });
  vEl.onloadedmetadata = () => {
    vEl.currentTime = t;
    vEl.play().catch(() => {});
  };
  [...refs.quality.children].forEach((b) => b.classList.toggle("on", b.textContent === def));
}

export function setRate(idx) {
  const r = RATES[idx % RATES.length];
  if (vEl) vEl.playbackRate = r;
  return r;
}
export function getRates() {
  return RATES;
}

function highlightEpisode(index) {
  if (!refs.episodeList) return;
  [...refs.episodeList.children].forEach((el, i) => el.classList.toggle("on", i === index));
}
