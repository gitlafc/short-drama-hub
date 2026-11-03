# 短剧漫剧聚合播放器 · Short Drama Hub

一个 **Web 版 MiniReel**：把短剧 / 漫剧 / AI 剧聚合到一个**无广告、本地化**的播放器里，手机、电脑浏览器都能看。对标开源项目 [MiniReel](https://github.com/yixuexiaoao/minireel-tv) 的体验，但用 Web 实现，开箱即用。

> 核心玩法：剧库 / 搜索 → 选剧 → 选集 → 播放（倍速、自动连播、进度记忆）→ 收藏 / 历史存本地。

---

## ✨ 功能

- 🎬 **剧库**：热播推荐、新上线，带封面 / 热度 / 标签。
- 🔍 **聚合搜索**：搜剧名 / 演员，实时返回结果。
- 📺 **内置播放器**：原生 video + hls.js，支持**倍速**（1x / 1.25x / 1.5x / 2x）、**清晰度切换**（按高度自动排序）、**自动连播下一集**、**播放进度记忆**。
- ⭐ **本地收藏 & 观看历史**：全部存于浏览器本地，不上传、不注册账号。
- 🌗 **深色 / 浅色**：默认深色，自动跟随系统，可手动切换。
- 📱 **响应式**：PC 与手机浏览器均适配（竖屏短剧居中播放）。

### 🆕 三条「不限流」通路（解决源限额）

平台公开接口常有**匿名设备限额**（红果返回 `ANONYMOUS_LIMITED`），本项目给出三条不依赖限额的通路：

| 通路 | 入口 | 说明 |
| --- | --- | --- |
| **自定义源** | 顶部「自定义源」 | 粘贴 **m3u8 / mp4 直链**或 **JSON API**，经本机代理播放。**完全不经过平台接口，零限额**。 |
| **本地片库** | 剧库 → 内容源切换 | 读取项目根目录 `media-manifest.json`（你自己的片库），零限额、零网络依赖。 |
| **红果短剧** | 剧库 → 内容源切换（默认） | 内置 `openhongguo` 非官方接口，有匿名设备限额；已加元数据缓存 + 退避冷却缓解。 |

---

## 🚀 运行

需要 **Node.js 18+**（本项目零构建，依赖只有 `openhongguo` 一个）。

```bash
cd short-drama-hub
npm install          # 安装 openhongguo（内容源 SDK）
npm start            # 启动服务，默认端口 8788
# 浏览器打开 http://127.0.0.1:8788
```

> 首次启动会加载 openhongguo 的 wasm 内核，稍等几秒。之后剧库、搜索、详情、播放即可使用。

---

## 🎯 自定义源用法（推荐通路，零限额）

进入顶部 **「自定义源」**，三步：

1. **剧名**（可选）：显示在标题栏。
2. **链接**：一行一条，支持两种写法
   ```
   https://cdn.example.com/ep1.m3u8
   第2集|https://cdn.example.com/ep2.mp4
   ```
   也可以只填一个 **JSON API 地址**，程序会尽力从常见结构里提取分集
   （`episodes` / `list` / `items` / `data` / `result` / `videos` 数组，元素里的
   `url` / `play_url` / `src` / `m3u8` / `hls` 均可识别）。
3. **「经本机代理」保持勾选** → 点 **▶ 播放**。

- **m3u8 自动识别**，由 hls.js 播放；服务端会把播放列表里的相对路径重写为同源代理地址，
  分片 / 密钥 / 子清单逐层递归代理，因此 **防盗链、CORS、跨域限制都不再是问题**。
- 支持**多集连播**、倍速、进度记忆；点 **💾 保存** 可把该源存入本地列表随时再播。

---

## 📁 本地片库（零限额、零网络）

在项目根目录维护 `media-manifest.json`（仓库里已有一份带示例的模板）：

```json
{
  "series": [
    {
      "id": "my-drama-1",
      "title": "我的短剧",
      "cover": "",
      "description": "备注",
      "episodes": [
        { "title": "第1集", "url": "https://cdn.example.com/ep1.mp4" },
        { "title": "第2集", "url": "https://cdn.example.com/ep2.m3u8" }
      ]
    }
  ]
}
```

保存后无需重启，回到剧库把 **内容源** 切到 **本地片库** 即可看到。
本地源播放同样走本机代理，mp4 / m3u8 通吃。

---

## 🧱 项目结构

```
short-drama-hub/
├── index.html                 # 单页播放器（剧库 / 自定义源 / 详情 / 播放 / 我的 五视图）
├── media-manifest.json        # 本地片库清单（模板，可替换成自己的内容）
├── demo/
│   └── api-list.json          # 演示用 JSON API（测试「自定义源 · API 模式」）
├── assets/
│   ├── css/style.css          # 样式（沉浸式深色 + 响应式）
│   ├── vendor/hls.min.js      # hls.js 1.5.17（已本地化，离线可用）
│   └── js/
│       ├── api.js             # 后端接口封装（带 source 参数）
│       ├── store.js           # 本地存储：收藏 / 历史 / 进度 / 自定义源
│       ├── player.js          # 播放器控制：倍速 / 清晰度 / 连播 / 进度 / hls.js
│       └── app.js             # 主逻辑：路由 / 剧库 / 搜索 / 详情 / 自定义源
├── server/
│   └── index.js               # 后端：静态托管 + 源注册表 + /api/* + 流式代理
├── scripts/
│   └── verify-browser.mjs     # 真实浏览器端到端自检（CDP 驱动 Chrome）
├── package.json               # type:module，依赖 openhongguo
├── LICENSE                    # MIT（本项目代码；内容源遵循 openhongguo 许可）
└── README.md
```

### 🧪 端到端自检

仓库内置一个用 **CDP 驱动本机 Chrome** 的自检脚本：真实打开页面、粘贴 m3u8、切换内容源，并断言 **video 真的在播放**（`currentTime > 0`）、无 JS 运行时异常。

```bash
npm start                      # 终端 A：启动服务
npm run verify                 # 终端 B：跑自检（16 项断言）
```

> 需要本机装有 Chrome；可用 `CHROME=...` / `APP_URL=...` 环境变量覆盖路径与地址。

---

## 🔌 后端接口契约

### 通用参数

所有内容接口都接受 `?source=<源ID>`，省略时使用默认源 `hongguo`。

| 接口 | 说明 |
| --- | --- |
| `GET /api/sources` | 列出全部可用内容源（前端下拉框数据源） |
| `GET /api/home?source=` | `{ hot, newReleases, categories, warning }` |
| `GET /api/search?q=关键词&source=` | `{ items, has_more }` |
| `GET /api/detail?id=剧集ID&source=` | `{ id, title, cover, episodes[], recommend[], ... }` |
| `GET /api/play?episodeId=分集ID&source=` | `{ url, definition, proxy, isM3u8, streams[] }` |

### 播放代理

```
GET /api/proxy?url=<上游地址>[&ref=<Referer>][&ua=<User-Agent>]
```

- 透传 **Range**（支持拖动进度、边下边播，返回 206）与重定向；
- 若上游是 **m3u8**，服务端会把播放列表内的相对路径解析为绝对地址并改写为代理地址，
  逐层递归（主清单 → 子清单 → 分片 / 密钥）；
- **不缓存、不落盘、不改写内容**，仅做带宽透传，用于绕开 CORS 与防盗链。

---

## 🧩 扩展一个新内容源

在 `server/index.js` 的 `SOURCES` 注册表里加一项即可，前端会自动出现在「内容源」下拉框中：

```js
const SOURCES = {
  // ...
  mysource: {
    id: "mysource",
    name: "我的源",
    desc: "描述",
    limited: false,
    async home()    { return { hot: [], newReleases: [], categories: [] }; },
    async search(q) { return { items: [], has_more: false }; },
    async detail(id){ return { id, title, cover, episodes: [], recommend: [] }; },
    async play(episodeId) {
      return { url: "https://.../ep.mp4", definition: "原画", proxy: true, streams: [] };
    },
  },
};
```

契约就这四个方法，返回结构与内置源一致，前端无需改动。

---

## ⚖️ 合规声明（务必阅读）

- 📄 内置源基于开源社区非官方 SDK **[`openhongguo`](https://github.com/beilunyang/openhongguo)**（红果短剧接口），
  **仅限个人学习 / 技术研究使用，禁止商用**，内容版权归原平台所有；
- 🚫 本项目**不托管、不存储、不解析改写**任何视频内容，剧集元数据与播放地址均来自上游接口的实时转发；
- ⚠️ 红果源使用**匿名设备**访问，存在**设备级请求限额**（`ANONYMOUS_LIMITED`），已做元数据缓存 + 退避冷却；
  受限时请切换到 **本地片库** 或 **自定义源**；
- 🔑 自定义源 / 本地片库播放的是**你自己提供**的地址，请确保内容来源合法、仅供个人使用。

---

## ☁️ 部署

前端是纯静态，可单独托管 `index.html` + `assets/`；但 `/api/*`（内容源接口 + 播放代理）需要运行
`server/index.js` 的后端。最简单：直接在能跑 Node 的机器上 `npm start`，或用 Nginx / Caddy 反向代理 8788 端口。

> 自定义源 / 本地片库的 m3u8 播放依赖后端的播放列表重写，**纯静态部署会退化为直连**（仍可播放，
> 但不再自动绕开防盗链与相对路径）。

---

## 📄 License

本项目代码采用 [MIT](./LICENSE)。内置内容源遵循 [`openhongguo`](https://github.com/beilunyang/openhongguo) 的许可（个人学习 / 非商用）。
