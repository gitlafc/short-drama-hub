// platforms.js
// 短剧漫剧平台聚合数据（纯配置，可自由扩展）。
//
// 合规说明：本文件只收录各平台的【官方公开入口】与【官方搜索页】。
// 项目本身不解析、不托管、不盗链任何第三方平台的视频流，所有跳转均指向官方页面。
// 若某平台的官方搜索页路径发生变更，请直接修改对应条目的 `search` 字段。
//
// 字段说明：
//   id      唯一标识（小写英文/数字）
//   name    显示名称
//   type    类型：real(真人剧) / anime(漫剧) / ai(AI剧) / mixed(综合)
//   free    是否以免费内容为主（用于"免费专区"筛选）
//   color   卡片主题色
//   icon    卡片图标（emoji 或单字）
//   home    官方主页（必填）
//   search  官方搜索页模板，{q} 为关键词占位符；留空则前端自动回退到站内搜索
//   ranked  是否有官方榜单（仅用于展示"榜单"入口提示）
//   note    备注

export const PLATFORMS = [
  // ---------- 综合 / 真人短剧 ----------
  {
    id: "hongguo",
    name: "红果短剧",
    type: "mixed",
    free: true,
    color: "#ff4d4f",
    icon: "红",
    home: "https://www.hongguo.com/",
    search: "",
    ranked: true,
    note: "字节系免费短剧平台，含真人剧、漫剧、AI剧。",
  },
  {
    id: "fanqie",
    name: "番茄短剧",
    type: "real",
    free: true,
    color: "#fa8c16",
    icon: "番",
    home: "https://fanqie.rom/",
    search: "",
    ranked: true,
    note: "番茄小说系短剧，海量免费真人剧。",
  },
  {
    id: "hema",
    name: "河马剧场",
    type: "real",
    free: true,
    color: "#13c2c2",
    icon: "河",
    home: "https://www.hema.cn/",
    search: "",
    ranked: true,
    note: "聚合型免费短剧平台。",
  },
  {
    id: "xifan",
    name: "西饭短剧",
    type: "real",
    free: true,
    color: "#722ed1",
    icon: "西",
    home: "https://www.xifan.com/",
    search: "",
    ranked: false,
    note: "免费真人短剧平台。",
  },
  {
    id: "jiuzhou",
    name: "九洲短剧",
    type: "real",
    free: false,
    color: "#eb2f96",
    icon: "九",
    home: "https://www.jiuzhou.com/",
    search: "",
    ranked: false,
    note: "短剧分发平台。",
  },

  // ---------- 大厂短视频 / 长视频内的短剧 ----------
  {
    id: "douyin",
    name: "抖音短剧",
    type: "mixed",
    free: true,
    color: "#000000",
    icon: "抖",
    home: "https://www.douyin.com/",
    search: "https://www.douyin.com/search/{q}",
    ranked: true,
    note: "抖音站内短剧频道，搜索即可找到剧集。",
  },
  {
    id: "kuaishou",
    name: "快手小剧场",
    type: "mixed",
    free: true,
    color: "#ff8000",
    icon: "快",
    home: "https://www.kuaishou.com/",
    search: "https://www.kuaishou.com/search/video?keyword={q}",
    ranked: true,
    note: "快手小剧场，竖屏短剧。",
  },
  {
    id: "bilibili",
    name: "B站短剧",
    type: "mixed",
    free: true,
    color: "#fb7299",
    icon: "B",
    home: "https://www.bilibili.com/",
    search: "https://search.bilibili.com/all?keyword={q}",
    ranked: true,
    note: "B 站短剧/微短剧分区。",
  },
  {
    id: "tencent",
    name: "腾讯微短剧",
    type: "mixed",
    free: false,
    color: "#2b6cff",
    icon: "腾",
    home: "https://v.qq.com/",
    search: "https://v.qq.com/x/search/?q={q}",
    ranked: true,
    note: "腾讯视频微短剧频道。",
  },
  {
    id: "youku",
    name: "优酷短剧",
    type: "real",
    free: false,
    color: "#00a0e9",
    icon: "优",
    home: "https://www.youku.com/",
    search: "https://so.youku.com/search_video/q_{q}",
    ranked: true,
    note: "优酷短剧频道。",
  },
  {
    id: "mgtv",
    name: "芒果短剧",
    type: "real",
    free: false,
    color: "#ff5c8a",
    icon: "芒",
    home: "https://www.mgtv.com/",
    search: "https://so.mgtv.com/so?k={q}",
    ranked: true,
    note: "芒果 TV 短剧频道。",
  },

  // ---------- 漫剧 ----------
  {
    id: "tencent-ac",
    name: "腾讯动漫·漫剧",
    type: "anime",
    free: true,
    color: "#ff9c00",
    icon: "漫",
    home: "https://ac.qq.com/",
    search: "https://ac.qq.com/Comic/index/search?search={q}",
    ranked: true,
    note: "腾讯动漫漫剧/动态漫画。",
  },
  {
    id: "kuaikan",
    name: "快看漫剧",
    type: "anime",
    free: true,
    color: "#ffcd00",
    icon: "看",
    home: "https://www.kuaikanmanhua.com/",
    search: "https://www.kuaikanmanhua.com/search?keyword={q}",
    ranked: true,
    note: "快看漫画漫剧专区。",
  },
  {
    id: "manman",
    name: "漫漫漫画",
    type: "anime",
    free: true,
    color: "#36cfc9",
    icon: "漫",
    home: "https://www.manmanapp.com/",
    search: "",
    ranked: false,
    note: "漫漫漫画漫剧/条漫。",
  },

  // ---------- AI 剧 ----------
  {
    id: "ai-drama",
    name: "AI 短剧精选",
    type: "ai",
    free: true,
    color: "#9254de",
    icon: "AI",
    home: "https://www.hongguo.com/",
    search: "",
    ranked: false,
    note: "AI 生成短剧，多平台均有专区，这里聚合入口到红果 AI 剧频道。",
  },
];

// 类型筛选标签（用于首页分类切换）
export const TYPE_LABELS = {
  all: "全部",
  real: "真人剧",
  anime: "漫剧",
  ai: "AI剧",
  mixed: "综合",
};

// 把搜索模板里的 {q} 替换为编码后的关键词；没有模板则用站内搜索兜底
export function buildSearchUrl(platform, query) {
  const q = encodeURIComponent(query.trim());
  if (platform.search && platform.search.includes("{q}")) {
    return platform.search.replace("{q}", q);
  }
  // 兜底：用 Bing 站内搜索（site: 限定到该平台域名）
  let host = "";
  try {
    host = new URL(platform.home).hostname;
  } catch (_) {
    host = "";
  }
  const site = host ? `%20site:${host}` : "";
  return `https://www.bing.com/search?q=${q}${site}`;
}
