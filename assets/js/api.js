// api.js —— 对后端内容源接口的封装
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j && j.error) msg = j.error;
    } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

// 追加内容源参数：base 已带 ? 则用 &，否则用 ?
function withSource(base, source) {
  if (!source) return base;
  return base + (base.includes("?") ? "&" : "?") + "source=" + encodeURIComponent(source);
}

export const api = {
  sources: () => getJSON("/api/sources"),
  home: (source) => getJSON(withSource("/api/home", source)),
  search: (q, source) => getJSON(withSource("/api/search?q=" + encodeURIComponent(q), source)),
  detail: (id, source) => getJSON(withSource("/api/detail?id=" + encodeURIComponent(id), source)),
  play: (episodeId, source) =>
    getJSON(withSource("/api/play?episodeId=" + encodeURIComponent(episodeId), source)),
};
