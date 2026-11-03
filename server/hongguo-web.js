// server/hongguo-web.js
//
// 红果官方**网页版**的播放通道（实测逆向结论，详见 README「红果接口实测」）。
//
// ── 为什么需要它 ────────────────────────────────────────────────
// 红果 App 端走的是番茄小说那套 fqnovel.com 接口 + 字节风控签名链
// （x-gorgon / x-argus / x-ladon / x-helios / x-medusa），并且对**匿名设备**限流：
// 出播放地址的 video_model 接口会「HTTP 200 + 空响应体」静默拒绝，SDK 只能报
// ANONYMOUS_LIMITED。官方 PC / 网页版则完全走另一条路。
//
// ── 网页版播放接口（实测）────────────────────────────────────────
//   POST https://hongguoduanju.com/api/video/protected/fallback-play-info?aid=8662
//   Content-Type: application/json
//   X-Xs-From-Web: 1
//   body: {"item_id":"<分集ID>"}
//
//   成功 → {"main_url":"https://v*-hgweb.qznovelvod.com/...?ft=<签名>&mime_type=video_mp4",
//          "url_expire":<unix>, "base_resp":{"StatusCode":0}}
//   失败 → HTTP 403 {"error":"public_fallback_unavailable"}
//
// ── 实测结论（全部经真实请求验证）─────────────────────────────────
//   · 无需 cookie / 登录态；
//   · 无需任何签名（对比 App 端的 5 层签名）；
//   · 无需 Referer / Origin；
//   · **User-Agent 必须是浏览器**（Node 默认的 `node` 只能拿到前 3 集，
//     伪装成 Chrome 后可拿前 5 集）；
//   · 返回的 mp4 直链可直接 Range 拉流，无需 Referer，约 1 小时后过期；
//   · 分集ID 与 openhongguo 的 episode.id 完全一致，可直接互用；
//   · 未登录上限为每部剧前 5 集 —— 已核对官方网页版行为：未登录时点第 6 集
//     不会切集、而是弹扫码登录框，故 5 集即官方未登录的真实上限。
//
// ── 未采用的另一个接口 ───────────────────────────────────────────
//   POST /api/video/protected/play-info  body: {series_id, item_id, definition}
//   返回 DASH + fMP4 + 音视频分离 + AES 加密（player_access_key 为解密密钥），
//   需专用播放器（官方用 DASHPlugin / Mp4EncryptPlayer），本项目未采用。

const PLAY_INFO_URL =
  "https://hongguoduanju.com/api/video/protected/fallback-play-info?aid=8662";

export const WEB_CHANNEL = "hongguo-web";

/** 浏览器 UA —— 关键：Node 默认 UA 只能拿到前 3 集 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

/**
 * 取分集的公开播放直链。
 * @returns {Promise<{ok:true,url:string,expiresAt:number} | {ok:false,error:string,code:string}>}
 */
export async function webPlayInfo(itemId, { timeoutMs = 15000, seriesId = "" } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "X-Xs-From-Web": "1",
      "User-Agent": BROWSER_UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    };
    if (seriesId) headers.Referer = `https://hongguoduanju.com/player/${seriesId}`;

    const res = await fetch(PLAY_INFO_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ item_id: String(itemId) }),
      signal: ctrl.signal,
    });

    // 失败时也要读 body，里面有 public_fallback_unavailable 之类的错误码
    let j = {};
    try {
      j = await res.json();
    } catch (_) {
      /* 非 JSON 响应 */
    }

    if (j?.main_url) {
      return {
        ok: true,
        url: j.main_url,
        expiresAt: Number(j.url_expire) || 0,
        definition: j.definition || "试看",
      };
    }
    const code = j?.error || `HTTP_${res.status}`;
    return {
      ok: false,
      error:
        code === "public_fallback_unavailable"
          ? "该集未开放公开播放（官方对未登录用户每部剧仅开放前 5 集试看）"
          : `播放接口未返回直链（${code}）`,
      code,
      status: res.status,
    };
  } catch (e) {
    return {
      ok: false,
      error: `播放接口请求失败：${e?.message || e}`,
      code: "REQUEST_FAILED",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 判断是否为「官方公开试看未开放该集」 */
export function isPublicFallbackUnavailable(code) {
  return code === "public_fallback_unavailable";
}
