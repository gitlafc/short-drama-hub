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

export const api = {
  home: () => getJSON("/api/home"),
  search: (q) => getJSON("/api/search?q=" + encodeURIComponent(q)),
  detail: (id) => getJSON("/api/detail?id=" + encodeURIComponent(id)),
  play: (episodeId) => getJSON("/api/play?episodeId=" + encodeURIComponent(episodeId)),
};
