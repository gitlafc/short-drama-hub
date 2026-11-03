# 短剧漫剧聚合平台 · Short Drama Hub

一个**轻量、零构建、开箱即用**的短剧 / 漫剧 / AI 剧聚合发现平台。把红果、番茄、河马、西饭、抖音、快手、B站、腾讯、优酷、芒果、腾讯动漫、快看、漫漫等主流平台的**官方入口**聚合到一起，并提供**统一搜索**——输入剧名，一键跳转到各平台官方搜索页。

> 🎯 定位：聚合**导航与发现**，不是视频解析/播放器。所有跳转均指向平台官方网站。

---

## ✨ 特性

- 🔍 **统一聚合搜索**：输入剧名，自动生成「在红果/B站/抖音/腾讯… 搜索」的官方链接，新标签一键打开。
- 🗂️ **类型筛选**：全部 / 真人剧 / 漫剧 / AI剧 / 综合，一键切换。
- 🆓 **免费专区**：只看好用的免费平台。
- ⭐ **收藏 & 历史**：基于浏览器本地存储，不上传任何数据；支持「仅看收藏」。
- 🌗 **深色模式**：自动跟随系统，可手动切换。
- 📱 **响应式**：PC 与手机浏览器均适配。
- 🧩 **零依赖**：纯前端，无需 `npm install`；也附带一个可选 Node 服务（依然零依赖）。

---

## ⚖️ 合规声明（务必阅读）

本项目**仅聚合各平台的官方公开入口与官方搜索页**，所有跳转都指向平台官方网站。

- ❌ 不解析、不托管、不盗链任何第三方平台的视频流；
- ❌ 不破解、不绕过任何平台的会员 / 付费 / 地区限制；
- ✅ 内容版权归各原平台 / 权利人所有，本项目仅作导航与发现用途。

如果你希望在此基础上做播放聚合（调用非官方接口解析视频流），请务必自行评估并承担相应平台的《用户协议》与当地法律法规风险。本项目默认形态保持合规。

---

## 🚀 快速开始

三种方式任选其一，**都不需要安装任何依赖**。

### 方式 A：直接双击打开（最简单）

直接双击 `index.html` 用浏览器打开即可使用。
（注：个别浏览器对 `file://` 下的 ES Module 有限制；若页面空白，请用方式 B / C。）

### 方式 B：Python 静态服务（推荐）

```bash
cd short-drama-hub
python -m http.server 8788
# 浏览器打开 http://127.0.0.1:8788
```

### 方式 C：Node 服务（可选，零依赖）

```bash
cd short-drama-hub
npm start            # 等价于 node server/proxy.js
# 浏览器打开 http://127.0.0.1:8788
```

Node 服务额外提供两个**只读**接口（仅做 URL 拼接，不向外发请求）：

- `GET /api/platforms` —— 返回平台配置数组
- `GET /api/search?q=关键词` —— 返回各平台的官方搜索链接

---

## 🧱 项目结构

```
short-drama-hub/
├── index.html              # 页面骨架
├── assets/
│   ├── css/style.css       # 样式（含浅色/深色主题）
│   └── js/
│       ├── platforms.js    # ★ 平台聚合数据（单一数据源，可自由增删）
│       ├── store.js        # 本地收藏/历史（localStorage）
│       └── app.js          # 主逻辑：渲染/搜索/筛选/收藏/主题
├── server/
│   └── proxy.js            # 可选 Node 静态服务 + 只读接口（零依赖）
├── package.json
├── LICENSE                 # MIT
└── README.md
```

---

## ➕ 如何新增 / 修正平台

所有平台都在 **`assets/js/platforms.js`** 一处维护。新增一条记录即可：

```js
{
  id: "myplatform",          // 唯一标识
  name: "某某短剧",           // 显示名
  type: "real",              // real(真人剧)/anime(漫剧)/ai(AI剧)/mixed(综合)
  free: true,                // 是否以免费为主
  color: "#ff4d4f",          // 卡片主题色
  icon: "某",                // 卡片图标（emoji 或单字）
  home: "https://example.com/",          // 官方主页（必填）
  search: "https://example.com/search?q={q}",  // 官方搜索模板，{q}=关键词；留空自动回退站内搜索
  ranked: true,              // 是否有官方榜单（仅展示用）
  note: "一句话说明",
}
```

> 若某平台官方搜索页路径变更导致跳转不准，只需修改对应 `search` 字段即可。

---

## ☁️ 部署（GitHub Pages）

1. 把本仓库推到 GitHub（见下方「关联远程仓库」）。
2. 仓库 Settings → Pages → Source 选择 `main` 分支根目录 → Save。
3. 几分钟后即可通过 `https://<你的用户名>.github.io/short-drama-hub/` 访问。

---

## 🔗 关联远程仓库（本机未安装 GitHub CLI，手动步骤）

本项目已在本地 `git init` 并提交。要把它推到 GitHub：

```bash
# 1. 在 https://github.com/new 新建一个名为 short-drama-hub 的空仓库（不要勾选 README/.gitignore）
# 2. 在本地仓库目录关联并推送：
cd short-drama-hub
git remote add origin https://github.com/<你的用户名>/short-drama-hub.git
git branch -M main
git push -u origin main
```

（若你已安装并登录 `gh`，也可：`gh repo create short-drama-hub --public --source=. --push`）

---

## 📌 已知限制

- 部分平台的「官方搜索页」路径会随版本调整；本项目的搜索以官方模板优先，缺失时回退到「站内搜索（Bing `site:` 限定）」，保证可用。
- 本项目是聚合**导航**，不直接提供播放；如需播放请在各平台官方内完成。

---

## 📄 License

[MIT](./LICENSE)
