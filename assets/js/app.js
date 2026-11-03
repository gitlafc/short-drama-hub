// app.js —— 主逻辑：剧库 / 搜索 / 详情 / 播放 / 我的
import { api } from "./api.js";
import { store } from "./store.js";
import { bindPlayer, openEpisode, setRate, getRates, getCurrent } from "./player.js";

const $ = (s) => document.querySelector(s);

const state = {
  tab: "hot",
  home: null,
  series: null, // 详情中的剧集对象
  episodes: null, // 详情中的分集列表
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
  ["home", "detail", "player", "fav"].forEach((v) =>
    $("#view-" + v).hidden = v !== name
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

// ---------- 剧库 ----------
async function loadHome() {
  $("#homeEmpty").hidden = false;
  $("#homeEmpty").textContent = "加载中…";
  try {
    const data = await api.home();
    state.home = data;
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
    const data = await api.search(q);
    renderGrid(data.items || []);
    if (!data.items || !data.items.length)
      $("#homeEmpty").textContent = "未找到相关短剧，换个关键词试试。";
  } catch (e) {
    $("#homeEmpty").hidden = false;
    $("#homeEmpty").textContent = "⚠️ 搜索失败：" + e.message;
  }
}

// ---------- 详情 ----------
async function openDetail(id, fromHistoryEp) {
  showView("detail");
  $("#dTitle").textContent = "加载中…";
  $("#dEpisodes").innerHTML = "";
  $("#dRec").innerHTML = "";
  try {
    const d = await api.detail(id);
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

// ---------- 事件 ----------
function bindEvents() {
  $("#themeBtn").addEventListener("click", toggleTheme);

  document.querySelectorAll(".nav button").forEach((b) =>
    b.addEventListener("click", () => {
      const go = b.dataset.go;
      if (go === "fav") renderFav();
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
      // 避免重复：仅当点击的是 grid / dRec / favGrid / hisGrid 内的卡片
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

  // 详情页收藏
  updateFavBtn($("#dFav"), null);
}

// ---------- 启动 ----------
function main() {
  initTheme();
  bindPlayer({
    video: $("#video"),
    title: $("#pTitle"),
    status: $("#pStatus"),
    quality: $("#quality"),
    episodeList: $("#pEpisodes"),
  });
  bindEvents();
  loadHome();
}
document.addEventListener("DOMContentLoaded", main);
