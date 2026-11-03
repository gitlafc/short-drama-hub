// player.js —— 视频播放器控制：加载播放地址、倍速、清晰度、进度记忆、自动连播
import { api } from "./api.js";
import { store } from "./store.js";

let vEl = null;
let refs = {};
let current = null; // { series, episodes, index }

const RATES = [1, 1.25, 1.5, 2];

export function bindPlayer(elements) {
  vEl = elements.video;
  refs = elements;

  vEl.addEventListener("timeupdate", () => {
    if (!current) return;
    const key = `${current.series.id}:${current.episodes[current.index].id}`;
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
}

export function getCurrent() {
  return current;
}

export async function openEpisode(series, episodes, index) {
  if (!episodes || !episodes[index]) return;
  current = { series, episodes, index };
  const ep = episodes[index];
  if (refs.title) refs.title.textContent = `${series.title} · 第${ep.number}集`;
  if (refs.status) refs.status.textContent = "正在获取播放地址…";

  try {
    const data = await api.play(ep.id);
    if (!data.url) throw new Error(data.error || "未获取到播放地址");

    // 清晰度选项
    if (refs.quality) {
      refs.quality.innerHTML = "";
      (data.streams || []).forEach((s) => {
        const b = document.createElement("button");
        b.className = "quality-btn" + (s.url === data.url ? " on" : "");
        b.textContent = s.definition || "?";
        b.onclick = () => switchQuality(s.url, s.definition);
        refs.quality.appendChild(b);
      });
    }

    vEl.src = data.url;
    const key = `${series.id}:${ep.id}`;
    const saved = store.getProg(key);
    vEl.onloadedmetadata = () => {
      if (saved && saved.d) vEl.currentTime = Math.min(saved.t, saved.d - 5);
    };
    await vEl.play().catch(() => {});
    if (refs.status) refs.status.textContent = "";

    store.addHis({
      id: series.id,
      title: series.title,
      cover: series.cover,
      ep: ep.id,
      epTitle: ep.title,
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
    vEl.removeAttribute("src");
    vEl.load();
  }
}

function switchQuality(url, def) {
  const t = vEl.currentTime;
  vEl.src = url;
  vEl.onloadedmetadata = () => {
    vEl.currentTime = t;
    vEl.play().catch(() => {});
  };
  [...refs.quality.children].forEach((b) =>
    b.classList.toggle("on", b.textContent === def)
  );
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
  [...refs.episodeList.children].forEach((el, i) =>
    el.classList.toggle("on", i === index)
  );
}
