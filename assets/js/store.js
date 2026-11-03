// store.js —— 本地存储：收藏 / 观看历史 / 播放进度（全部存于浏览器本地，不上传）
const K_FAV = "sdh_fav";
const K_HIS = "sdh_his";
const K_PROG = "sdh_prog";
const K_THEME = "sdh_theme";
const K_CUS = "sdh_custom";
const K_SRC = "sdh_source";

function rd(k, d) {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v === null || v === undefined ? d : v;
  } catch (_) {
    return d;
  }
}
function wt(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (_) {
    /* 隐私模式等忽略 */
  }
}

export const store = {
  // ---- 收藏：{ [id]: { title, cover } } ----
  getFav() {
    return rd(K_FAV, {});
  },
  isFav(id) {
    return !!this.getFav()[id];
  },
  toggleFav(item) {
    const f = this.getFav();
    if (f[item.id]) delete f[item.id];
    else f[item.id] = { title: item.title, cover: item.cover };
    wt(K_FAV, f);
    return f;
  },

  // ---- 历史：[{ id, title, cover, ep, epTitle, ts }] ----
  getHis() {
    return rd(K_HIS, []);
  },
  addHis(item) {
    let h = this.getHis().filter((x) => !(x.id === item.id && x.ep === item.ep));
    h.unshift(item);
    if (h.length > 60) h = h.slice(0, 60);
    wt(K_HIS, h);
  },
  clearHis() {
    wt(K_HIS, []);
  },

  // ---- 播放进度：{ "seriesId:epId": { t, d, ts } } ----
  getProg(key) {
    return rd(K_PROG, {})[key] || null;
  },
  setProg(key, t, d) {
    const p = rd(K_PROG, {});
    p[key] = { t, d, ts: Date.now() };
    wt(K_PROG, p);
  },

  // ---- 主题 ----
  getTheme() {
    return localStorage.getItem(K_THEME) || "";
  },
  setTheme(t) {
    localStorage.setItem(K_THEME, t);
  },

  // ---- 自定义源：[{ id, title, urls, mode, proxy, ts }] ----
  getCustom() {
    return rd(K_CUS, []);
  },
  addCustom(item) {
    let list = this.getCustom().filter((x) => x.id !== item.id);
    list.unshift({ ...item, ts: Date.now() });
    if (list.length > 30) list = list.slice(0, 30);
    wt(K_CUS, list);
    return list;
  },
  removeCustom(id) {
    const list = this.getCustom().filter((x) => x.id !== id);
    wt(K_CUS, list);
    return list;
  },

  // ---- 当前内容源偏好 ----
  getSource() {
    return localStorage.getItem(K_SRC) || "";
  },
  setSource(s) {
    localStorage.setItem(K_SRC, s);
  },
};
