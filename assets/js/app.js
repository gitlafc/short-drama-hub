// app.js —— 主逻辑：剧库 / 搜索 / 详情 / 播放 / 我的 / 自定义源
import { api } from "./api.js";
import { store } from "./store.js";
import { bindPlayer, openEpisode, setRate, getRates, getCurrent, isM3u8, proxyUrl } from "./player.js";

const $ = (s) => document.querySelector(s);

const state = {
  tab: "hot",
  source: "", // 当前内容源 id（hongguo / local）
  home: null,
  series: null, // 详情中的剧集对象
  episodes: null, // 详情中的分集列表
  custom: null, // 自定义源的合成剧集对象
};

// ---------- 主题 ----------
function initTheme() {
  const saved = store.getTheme();
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeBtn(theme);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  store.setTheme(next);
  updateThemeBtn(next);
}
function updateThemeBtn(t) {
  $("#themeBtn").textContent = t === "dark" ? "🌙" : "☀️";
}

// ---------- 视图 ----------
function showView(name) {
  ["home", "detail", "player", "fav", "custom"].forEach((v) =>
    ($("#view-" + v).hidden = v !== name)
  );
  document.querySelectorAll(".nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.go === name)
  );
  window.scrollTo(0, 0);
}

// ---------- 封面（HEIC 回退占位） ----------
function buildCover(item) {
  const cover = document.createElement("div");
  cover.className = "cover";
  const ph = (item.title || "剧").slice(0, 1);
  if (item.cover) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = item.cover;
    img.alt = item.title || "";
    img.onerror = () => {
      cover.classList.add("ph");
      cover.textContent = ph;
    };
    cover.appendChild(img);
  } else {
    cover.classList.add("ph");
    cover.textContent = ph;
  }
  return cover;
}

// ---------- 卡片 ----------
function buildCard(item) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.id = item.id;
  card.appendChild(buildCover(item));

  const body = document.createElement("div");
  body.className = "card-body";
  const h = document.createElement("h3");
  h.textContent = item.title || "未命名";
  body.appendChild(h);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  if (item.heat) {
    const sp = document.createElement("span");
    sp.className = "heat";
    sp.textContent = "🔥 " + item.heat;
    meta.appendChild(sp);
  }
  if (item.tag) {
    const sp = document.createElement("span");
    sp.className = "tag";
    sp.textContent = item.tag;
    meta.appendChild(sp);
  }
  if (item.episode_count) {
    const sp = document.createElement("span");
    sp.className = "eps";
    sp.textContent = item.episode_count + "集";
    meta.appendChild(sp);
  }
  body.appendChild(meta);
  card.appendChild(body);
  return card;
}

function renderGrid(items) {
  const grid = $("#grid");
  grid.innerHTML = "";
  if (!items || !items.length) {
    $("#homeEmpty").hidden = false;
    $("#homeEmpty").textContent = "暂无内容，源可能受限，请稍后重试或更换关键词。";
    return;
  }
  $("#homeEmpty").hidden = true;
  const frag = document.createDocumentFragment();
  items.forEach((it) => frag.appendChild(buildCard(it)));
  grid.appendChild(frag);
}

// ---------- 内容源 ----------
async function loadSources() {
  try {
    const data = await api.sources();
    const sel = $("#sourceSel");
    sel.innerHTML = "";
    (data.sources || []).forEach((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name + (s.limited ? "（有限额）" : "");
      sel.appendChild(o);
    });
    const saved = store.getSource();
    const ok = (data.sources || []).some((s) => s.id === saved);
    state.source = ok ? saved : data.default || (data.sources[0] && data.sources[0].id) || "";
    sel.value = state.source;
  } catch (e) {
    state.source = "hongguo";
    $("#srcWarn").textContent = "内容源列表加载失败：" + e.message;
  }
}

function onSourceChange(v) {
  state.source = v;
  store.setSource(v);
  state.home = null;
  loadHome();
}

// ---------- 剧库 ----------
async function loadHome() {
  $("#homeEmpty").hidden = false;
  $("#homeEmpty").textContent = "加载中…";
  $("#srcWarn").textContent = "";
  try {
    const data = await api.home(state.source);
    state.home = data;
    if (data.warning) $("#srcWarn").textContent = "⚠️ " + data.warning;
    applyTab();
  } catch (e) {
    $("#homeEmpty").hidden = false;
    $("#homeEmpty").textContent = "⚠️ 加载失败：" + e.message;
  }
}

function applyTab() {
  const h = state.home || {};
  let items = [];
  if (state.tab === "hot") items = h.hot || [];
  else if (state.tab === "new") items = h.newReleases || [];
  else {
    const seen = new Set();
    items = [...(h.hot || []), ...(h.newReleases || [])].filter((x) => {
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  }
  renderGrid(items);
}

// ---------- 搜索 ----------
async function doSearch(q) {
  q = (q || "").trim();
  if (!q) return;
  $("#homeEmpty").hidden = false;
  $("#homeEmpty").textContent = `搜索“${q}”中…`;
  try {
    const data = await api.search(q, state.source);
    renderGrid(data.items || []);
    if (!data.items || !data.items.length)
      $("#homeEmpty").textContent = "未找到相关短剧，换个关键词试试。";
  } catch (e) {
    $("#homeEmpty").hidden = false;
    $("#homeEmpty").textContent = "⚠️ 搜索失败：" + e.message;
  }
}

// ---------- 详情 ----------
async function openDetail(id) {
  showView("detail");
  $("#dTitle").textContent = "加载中…";
  $("#dEpisodes").innerHTML = "";
  $("#dRec").innerHTML = "";
  try {
    const d = await api.detail(id, state.source);
    d.source = state.source;
    state.series = d;
    state.episodes = d.episodes || [];
    renderDetail(d);
    renderEpisodes($("#dEpisodes"), d.episodes, (idx) => openPlayer(idx));
    renderRecommend(d.recommend || []);
    updateFavBtn($("#dFav"), { id: d.id, title: d.title, cover: d.cover });
  } catch (e) {
    $("#dTitle").textContent = "⚠️ 加载失败：" + e.message;
  }
}

function renderDetail(d) {
  $("#dTitle").textContent = d.title || "未命名";
  const meta = [];
  if (d.episode_count) meta.push(d.episode_count + "集");
  if (d.heat) meta.push("🔥 " + d.heat);
  if (d.tag) meta.push(d.tag);
  $("#dMeta").textContent = meta.join(" · ");
  $("#dDesc").textContent = d.description || "";
  const coverBox = $("#dCover");
  if (d.cover) {
    const img = document.createElement("img");
    img.src = d.cover;
    img.alt = d.title || "";
    img.onerror = () => {
      coverBox.classList.add("ph");
      coverBox.textContent = (d.title || "剧").slice(0, 1);
    };
    coverBox.innerHTML = "";
    coverBox.appendChild(img);
  } else {
    coverBox.classList.add("ph");
    coverBox.textContent = (d.title || "剧").slice(0, 1);
  }
}

function renderEpisodes(container, episodes, onPick) {
  container.innerHTML = "";
  if (!episodes || !episodes.length) {
    container.innerHTML = '<p class="empty">暂无分集</p>';
    return;
  }
  episodes.forEach((ep, idx) => {
    const b = document.createElement("button");
    b.className = "ep-btn";
    b.textContent = ep.number;
    b.title = ep.title || `第${ep.number}集`;
    b.onclick = () => onPick(idx);
    container.appendChild(b);
  });
}

function renderRecommend(list) {
  const grid = $("#dRec");
  grid.innerHTML = "";
  if (!list || !list.length) return;
  list.forEach((it) => grid.appendChild(buildCard(it)));
}

// ---------- 播放 ----------
function openPlayer(index) {
  showView("player");
  renderEpisodes($("#pEpisodes"), state.episodes, (idx) => openPlayer(idx));
  openEpisode(state.series, state.episodes, index);
}

// ---------- 收藏按钮 ----------
function updateFavBtn(btn, item) {
  if (!btn) return;
  const id = item ? item.id : getCurrent()?.series?.id;
  if (!id) return;
  const on = store.isFav(id);
  btn.textContent = on ? "★ 已收藏" : "☆ 收藏";
  btn.onclick = () => {
    store.toggleFav({ id, title: item?.title || state.series?.title, cover: item?.cover || state.series?.cover });
    updateFavBtn(btn, { id, title: item?.title || state.series?.title, cover: item?.cover || state.series?.cover });
  };
}

// ---------- 我的 ----------
function renderFav() {
  const fav = store.getFav();
  const favGrid = $("#favGrid");
  favGrid.innerHTML = "";
  const favItems = Object.entries(fav).map(([id, v]) => ({ id, ...v }));
  if (!favItems.length) favGrid.innerHTML = '<p class="empty">还没有收藏，去剧库逛逛吧～</p>';
  else favItems.forEach((it) => favGrid.appendChild(buildCard(it)));

  const his = store.getHis();
  const hisGrid = $("#hisGrid");
  hisGrid.innerHTML = "";
  if (!his.length) hisGrid.innerHTML = '<p class="empty">还没有观看记录。</p>';
  else his.forEach((it) => hisGrid.appendChild(buildCard(it)));
}

// ============================================================================
// 自定义源（方案 2）：粘贴 m3u8 / mp4 直链，或 JSON API
// ============================================================================

function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return "cus_" + h.toString(36);
}

// 从任意 JSON 结构里尽力提取剧集列表
function extractEpisodes(json) {
  const arr =
    (Array.isArray(json) && json) ||
    (Array.isArray(json?.episodes) && json.episodes) ||
    (Array.isArray(json?.list) && json.list) ||
    (Array.isArray(json?.items) && json.items) ||
    (Array.isArray(json?.data) && json.data) ||
    (Array.isArray(json?.result) && json.result) ||
    (Array.isArray(json?.videos) && json.videos) ||
    null;
  if (!arr) return [];
  return arr
    .map((x, i) => {
      if (typeof x === "string") return { url: x, title: `第${i + 1}集`, number: i + 1 };
      const url =
        x.url || x.play_url || x.playUrl || x.src || x.m3u8 || x.hls || x.stream_url || x.streamUrl || x.source || "";
      const title = x.title || x.name || x.episode_title || x.label || `第${i + 1}集`;
      const number = x.number || x.episode || x.index || i + 1;
      return { url, title, number };
    })
    .filter((e) => e.url);
}

// 解析「直链列表」文本：支持 "标题|URL" 与纯 URL 两种写法
function parseDirectList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      let title = "";
      let url = line;
      const m = line.match(/^(.+?)\s*[|｜]\s*(https?:\/\/\S+)$/);
      if (m) {
        title = m[1].trim();
        url = m[2].trim();
      }
      return { url, title: title || `第${i + 1}集`, number: i + 1 };
    })
    .filter((e) => /^https?:\/\//i.test(e.url));
}

function looksLikeApi(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 1) return false;
  const u = lines[0];
  return /\.json(\?|$)/i.test(u) || /\/api\//i.test(u) || /[?&](api|list|eps)=/i.test(u);
}

async function buildCustomEpisodes() {
  const raw = ($("#cusUrls").value || "").trim();
  if (!raw) throw new Error("请先粘贴链接或 API 地址");
  const mode = $("#cusMode").value;
  const proxy = $("#cusProxy").checked;

  let eps = [];
  if (mode === "direct") {
    eps = parseDirectList(raw);
  } else if (mode === "api") {
    const list = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const u of list) {
      const r = await fetch(proxyUrl(u));
      if (!r.ok) throw new Error("API 拉取失败：" + r.status + " " + u);
      const j = await r.json();
      eps.push(...extractEpisodes(j));
    }
  } else {
    // auto
    if (looksLikeApi(raw)) {
      const u = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
      const r = await fetch(proxyUrl(u));
      if (!r.ok) throw new Error("API 拉取失败：" + r.status);
      eps = extractEpisodes(await r.json());
    } else {
      eps = parseDirectList(raw);
    }
  }

  if (!eps.length) throw new Error("没解析到可播放地址，请检查链接格式");

  return eps.map((e, i) => ({
    id: `cus_ep_${i + 1}`,
    number: e.number || i + 1,
    title: e.title || `第${i + 1}集`,
    url: e.url,
    direct: true,
    proxy,
    isM3u8: isM3u8(e.url),
  }));
}

function customSeries(eps, title) {
  const t = title || "自定义源";
  return {
    id: hashId(t + "|" + eps[0].url),
    title: t,
    cover: "",
    description: "自定义源（" + eps.length + " 集）",
    episode_count: eps.length,
    source: "custom",
    episodes: eps,
  };
}

function cusMsg(text, isErr) {
  const el = $("#cusMsg");
  el.textContent = text || "";
  el.classList.toggle("err", !!isErr);
}

async function doCustomPlay() {
  cusMsg("解析中…");
  try {
    const eps = await buildCustomEpisodes();
    const title = ($("#cusTitle").value || "").trim() || "自定义源";
    state.custom = customSeries(eps, title);
    state.series = state.custom;
    state.episodes = eps;
    cusMsg(`✅ 已解析 ${eps.length} 集，开始播放。`);
    showView("player");
    renderEpisodes($("#pEpisodes"), eps, (idx) => openPlayer(idx));
    openEpisode(state.custom, eps, 0);
  } catch (e) {
    cusMsg("⚠️ " + e.message, true);
  }
}

function doCustomSave() {
  try {
    const raw = ($("#cusUrls").value || "").trim();
    if (!raw) throw new Error("内容为空");
    const title = ($("#cusTitle").value || "").trim() || "自定义源";
    const id = hashId(title + "|" + raw);
    store.addCustom({
      id,
      title,
      urls: raw,
      mode: $("#cusMode").value,
      proxy: $("#cusProxy").checked,
    });
    cusMsg("💾 已保存到「自定义源」列表。");
    renderCustomList();
  } catch (e) {
    cusMsg("⚠️ " + e.message, true);
  }
}

function renderCustomList() {
  const box = $("#cusList");
  box.innerHTML = "";
  const list = store.getCustom();
  if (!list.length) {
    box.innerHTML = '<p class="empty">还没有保存的自定义源。</p>';
    return;
  }
  list.forEach((c) => {
    const row = document.createElement("div");
    row.className = "cus-item";
    const info = document.createElement("div");
    info.className = "cus-info";
    const h = document.createElement("strong");
    h.textContent = c.title || "自定义源";
    const p = document.createElement("p");
    p.textContent = (c.urls || "").split(/\r?\n/)[0].slice(0, 80);
    info.appendChild(h);
    info.appendChild(p);

    const acts = document.createElement("div");
    acts.className = "cus-acts";
    const play = document.createElement("button");
    play.className = "btn";
    play.textContent = "▶ 播放";
    play.onclick = () => {
      $("#cusTitle").value = c.title || "";
      $("#cusUrls").value = c.urls || "";
      $("#cusMode").value = c.mode || "auto";
      $("#cusProxy").checked = c.proxy !== false;
      doCustomPlay();
    };
    const del = document.createElement("button");
    del.className = "btn-ghost";
    del.textContent = "删除";
    del.onclick = () => {
      store.removeCustom(c.id);
      renderCustomList();
    };
    acts.appendChild(play);
    acts.appendChild(del);

    row.appendChild(info);
    row.appendChild(acts);
    box.appendChild(row);
  });
}

// ---------- 事件 ----------
function bindEvents() {
  $("#themeBtn").addEventListener("click", toggleTheme);

  document.querySelectorAll(".nav button").forEach((b) =>
    b.addEventListener("click", () => {
      const go = b.dataset.go;
      if (go === "fav") renderFav();
      if (go === "custom") renderCustomList();
      showView(go);
    })
  );

  document.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.go))
  );

  $("#searchBtn").addEventListener("click", () => doSearch($("#searchInput").value));
  $("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch($("#searchInput").value);
  });

  $("#sourceSel").addEventListener("change", (e) => onSourceChange(e.target.value));

  $("#tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    [...$("#tabs").children].forEach((b) => b.classList.toggle("active", b === btn));
    if (state.home) applyTab();
  });

  // 卡片点击 → 详情（委托）
  document.body.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card && card.dataset.id && !e.target.closest(".ep-btn")) {
      const parent = card.parentElement;
      if (parent && /grid|Rec|favGrid|hisGrid/.test(parent.id)) {
        openDetail(card.dataset.id);
      }
    }
  });

  // 倍速
  let rateIdx = 0;
  $("#rateBtn").addEventListener("click", () => {
    rateIdx = (rateIdx + 1) % getRates().length;
    const r = setRate(rateIdx);
    $("#rateBtn").textContent = r + "x";
  });

  // 自定义源
  $("#cusPlay").addEventListener("click", doCustomPlay);
  $("#cusSave").addEventListener("click", doCustomSave);

  // 详情页收藏
  updateFavBtn($("#dFav"), null);
}

// ---------- 启动 ----------
async function main() {
  initTheme();
  bindPlayer({
    video: $("#video"),
    title: $("#pTitle"),
    status: $("#pStatus"),
    quality: $("#quality"),
    episodeList: $("#pEpisodes"),
  });
  bindEvents();
  await loadSources();
  renderCustomList();
  loadHome();
}
document.addEventListener("DOMContentLoaded", main);
