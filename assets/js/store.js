// store.js
// 本地存储：收藏与搜索历史（基于 localStorage，不上传任何数据）

const KEY_FAV = "sdh_favorites";
const KEY_HIS = "sdh_history";
const HIS_MAX = 30;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* 忽略存储异常（隐私模式等） */
  }
}

export const store = {
  getFavorites() {
    return read(KEY_FAV, []); // 返回平台 id 数组
  },
  isFavorite(id) {
    return this.getFavorites().includes(id);
  },
  toggleFavorite(id) {
    const list = this.getFavorites();
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(id);
    write(KEY_FAV, list);
    return list;
  },

  getHistory() {
    return read(KEY_HIS, []); // 返回搜索词数组（最新在前）
  },
  addHistory(q) {
    q = (q || "").trim();
    if (!q) return;
    let list = this.getHistory().filter((x) => x !== q);
    list.unshift(q);
    if (list.length > HIS_MAX) list = list.slice(0, HIS_MAX);
    write(KEY_HIS, list);
  },
  clearHistory() {
    write(KEY_HIS, []);
  },
};
