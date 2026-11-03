// app.js
import { PLATFORMS, TYPE_LABELS, buildSearchUrl } from "./platforms.js";
import { store } from "./store.js";

const $ = (sel) => document.querySelector(sel);

const state = {
  type: "all",
  onlyFav: false,
  onlyFree: false,
  query: "",
};

// ---------- 主题 ----------
function initTheme() {
  const saved = localStorage.getItem("sdh_theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeBtn(theme);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("sdh_theme", next);
  updateThemeBtn(next);
}
function updateThemeBtn(theme) {
  $("#themeBtn").textContent = theme === "dark" ? "☀️" : "🌙";
}

// ---------- 平台卡片 ----------
function platformCard(p) {
  const fav = store.isFavorite(p.id);
  return `
  <article class="card" data-id="${p.id}" style="--accent:${p.color}">
    <div class="card-head">
      <span class="logo" style="background:${p.color}">${p.icon}</span>
      <div class="card-title">
        <h3>${p.name}</h3>
        <div class="tags">
          <span class="tag type-${p.type}">${TYPE_LABELS[p.type] || p.type}</span>
          ${p.free ? '<span class="tag free">免费</span>' : ""}
          ${p.ranked ? '<span class="tag rank">榜单</span>' : ""}
        </div>
      </div>
      <button class="fav-btn ${fav ? "on" : ""}" data-fav="${p.id}" title="收藏">${fav ? "★" : "☆"}</button>
    </div>
    <p class="note">${p.note || ""}</p>
    <div class="card-actions">
      <a class="btn primary" href="${p.home}" target="_blank" rel="noopener">打开主页</a>
      <button class="btn ghost" data-search="${p.id}">站内搜索</button>
    </div>
  </article>`;
}

function filteredPlatforms() {
  return PLATFORMS.filter((p) => {
    if (state.onlyFav && !store.isFavorite(p.id)) return false;
    if (state.onlyFree && !p.free) return false;
    if (state.type !== "all" && p.type !== state.type) return false;
    return true;
  });
}

function renderPlatforms() {
  const list = filteredPlatforms();
  const grid = $("#platformGrid");
  if (list.length === 0) {
    grid.innerHTML = `<p class="empty">没有匹配的平台，换个筛选条件试试～</p>`;
    return;
  }
  grid.innerHTML = list.map(platformCard).join("");
}

// ---------- 统一搜索 ----------
function doSearch(query) {
  state.query = query.trim();
  if (!state.query) {
    showHome();
    return;
  }
  store.addHistory(state.query);
  renderHistory();
  $("#homeView").hidden = true;
  $("#searchView").hidden = false;
  $("#searchTitle").textContent = `在以下平台搜索：“${state.query}”`;
  $("#searchResults").innerHTML = PLATFORMS.map((p) => {
    const url = buildSearchUrl(p, state.query);
    return `
    <a class="search-row" href="${url}" target="_blank" rel="noopener" style="--accent:${p.color}">
      <span class="logo small" style="background:${p.color}">${p.icon}</span>
      <span class="sr-name">${p.name}</span>
      <span class="sr-go">搜索 ↗</span>
    </a>`;
  }).join("");
  $("#searchView").scrollIntoView({ behavior: "smooth" });
}

function showHome() {
  $("#searchView").hidden = true;
  $("#homeView").hidden = false;
  $("#query").value = "";
  state.query = "";
}

// ---------- 历史 ----------
function renderHistory() {
  const his = store.getHistory();
  const box = $("#history");
  if (his.length === 0) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML =
    `<div class="his-head"><span>搜索历史</span><button id="clearHis" class="link">清空</button></div>` +
    `<div class="his-chips">` +
    his.map((h) => `<button class="chip" data-his="${h}">${h}</button>`).join("") +
    `</div>`;
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $("#themeBtn").addEventListener("click", toggleTheme);

  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    doSearch($("#query").value);
  });

  $("#backHome").addEventListener("click", showHome);

  // 分类筛选
  $("#typeTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-type]");
    if (!btn) return;
    state.type = btn.dataset.type;
    [...$("#typeTabs").children].forEach((b) =>
      b.classList.toggle("active", b.dataset.type === state.type)
    );
    renderPlatforms();
  });

  // 收藏 / 免费 切换
  $("#onlyFav").addEventListener("change", (e) => {
    state.onlyFav = e.target.checked;
    renderPlatforms();
  });
  $("#onlyFree").addEventListener("change", (e) => {
    state.onlyFree = e.target.checked;
    renderPlatforms();
  });

  // 平台卡片：收藏 + 站内搜索（事件委托）
  $("#platformGrid").addEventListener("click", (e) => {
    const favBtn = e.target.closest("[data-fav]");
    if (favBtn) {
      const id = favBtn.dataset.fav;
      store.toggleFavorite(id);
      favBtn.classList.toggle("on");
      favBtn.textContent = store.isFavorite(id) ? "★" : "☆";
      if (state.onlyFav) renderPlatforms();
      return;
    }
    const searchBtn = e.target.closest("[data-search]");
    if (searchBtn) {
      const p = PLATFORMS.find((x) => x.id === searchBtn.dataset.search);
      if (p) doSearch(p.name);
    }
  });

  // 历史点击（委托到 #history，可能动态生成）
  document.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-his]");
    if (chip) {
      $("#query").value = chip.dataset.his;
      doSearch(chip.dataset.his);
      return;
    }
    if (e.target.id === "clearHis") {
      store.clearHistory();
      renderHistory();
    }
  });
}

// ---------- 启动 ----------
function main() {
  initTheme();
  bindEvents();
  renderPlatforms();
  renderHistory();
}
document.addEventListener("DOMContentLoaded", main);
