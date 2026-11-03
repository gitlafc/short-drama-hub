# 短剧漫剧聚合播放器 · Short Drama Hub

一个 **Web 版 MiniReel**：把红果等平台的短剧 / 漫剧 / AI 剧聚合到一个**无广告、本地化**的播放器里，手机、电脑浏览器都能看。对标开源项目 [MiniReel](https://github.com/yixuexiaoao/minireel-tv) 的体验，但用 Web 实现，开箱即用。

> 核心玩法：剧库 / 搜索 → 选剧 → 选集 → 播放（倍速、自动连播、进度记忆）→ 收藏 / 历史存本地。

---

## ✨ 功能

- 🎬 **剧库**：热播推荐、新上线，带封面 / 热度 / 标签。
- 🔍 **聚合搜索**：搜剧名 / 演员，实时返回结果。
- 📺 **内置播放器**：原生 video，支持**倍速**（1x / 1.25x / 1.5x / 2x）、**清晰度切换**（按高度自动排序）、**自动连播下一集**、**播放进度记忆**。
- ⭐ **本地收藏 & 观看历史**：全部存于浏览器本地，不上传、不注册账号。
- 🌗 **深色 / 浅色**：默认深色，自动跟随系统，可手动切换。
- 📱 **响应式**：PC 与手机浏览器均适配（竖屏短剧居中播放）。

---

## ⚖️ 合规声明（务必阅读）

本项目是一个**播放器壳 + 可插拔内容源**，内容来自开源社区非官方 SDK **[`openhongguo`](https://github.com/beilunyang/openhongguo)**（红果短剧接口）：

- 📄 **`openhongguo` 仅限个人学习 / 技术研究使用，禁止商用**，内容版权归原平台所有；
- 🚫 本项目**不托管、不存储、不解析改写**任何视频内容，所有剧集元数据与播放地址均来自上游接口的实时转发（播放地址为带签名的临时直链）；
- ⚠️ 上游接口使用**匿名设备**访问，存在**设备级请求限额**（`ANONYMOUS_LIMITED`），偶发返回空 → 播放页会提示并可一键重试，稍后或更换网络通常即可恢复；
- 如需接入其他平台源，请在 `server/index.js` 的 `sources` 处按相同契约扩展，并自行评估合规性。

---

## 🚀 运行

需要 **Node.js 18+**（已内置依赖，无需额外安装除 `npm install` 外的东西）。

```bash
cd short-drama-hub
npm install          # 安装 openhongguo（内容源 SDK）
npm start            # 启动服务，默认端口 8788
# 浏览器打开 http://127.0.0.1:8788
```

> 首次启动会下载 / 加载 openhongguo 的 wasm 内核，稍等几秒。之后剧库、搜索、详情、播放即可使用。

---

## 🧱 项目结构

```
short-drama-hub/
├── index.html              # 单页播放器（剧库 / 详情 / 播放 / 我的 四视图）
├── assets/
│   ├── css/style.css       # 样式（沉浸式深色 + 响应式）
│   └── js/
│       ├── api.js          # 后端接口封装
│       ├── store.js        # 本地存储：收藏 / 历史 / 进度
│       ├── player.js       # 播放器控制：倍速 / 清晰度 / 连播 / 进度
│       └── app.js          # 主逻辑：路由 / 剧库 / 搜索 / 详情
├── server/
│   └── index.js            # 后端源服务（ESM）：静态托管 + /api/* 内容源接口
├── package.json            # type:module，依赖 openhongguo
├── LICENSE                 # MIT（本项目代码；内容源遵循 openhongguo 许可）
└── README.md
```

---

## 🔌 后端接口契约（如需扩展源）

- `GET /api/home` → `{ hot, newReleases, categories }`
- `GET /api/search?q=关键词` → `{ items, has_more }`
- `GET /api/detail?id=剧集ID` → `{ id, title, cover, episodes, recommend, ... }`
- `GET /api/play?episodeId=分集ID` → `{ url, definition, streams }`

---

## ☁️ 部署（GitHub Pages / 任意静态托管）

前端是纯静态，可单独托管 `index.html` + `assets/`（需把 `/api/*` 请求代理到运行 `server/index.js` 的后端，或改为直连）。最简单：直接在能跑 Node 的机器上 `npm start`，或用反向代理暴露 8788 端口。

---

## 📄 License

本项目代码采用 [MIT](./LICENSE)。内容源遵循 [`openhongguo`](https://github.com/beilunyang/openhongguo) 的许可（个人学习 / 非商用）。
