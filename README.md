<div align="center">

# 折角

**把微信读书的书架、划线和进度，留在自己的电脑上慢慢看。**

[![GitHub stars](https://img.shields.io/github/stars/lurui1997/read-life?style=for-the-badge&logo=github)](https://github.com/lurui1997/read-life/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/lurui1997/read-life?style=for-the-badge&logo=github)](https://github.com/lurui1997/read-life/network/members)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![CI](https://github.com/lurui1997/read-life/actions/workflows/ci.yml/badge.svg)](https://github.com/lurui1997/read-life/actions/workflows/ci.yml)

[快速开始](#快速开始) · [功能亮点](#功能亮点) · [惊喜模式](#惊喜模式) · [开源与部署](#开源与部署) · [开发](#开发)

</div>

---

## 这是什么

**折角**是一个**本机优先**的微信读书同步站：

- 粘贴 API Key → 同步书架、进度、划线
- 在浏览器里按自己的节奏浏览、回看、邂逅好书
- 数据落在本机 SQLite，Key 不出你的电脑

适合书架 **上千本**、想拥有**私人阅读档案**的读者。

---

## 目录

- [这是什么](#这是什么)
- [界面预览](#界面预览)
- [为什么选择](#为什么选择)
- [功能亮点](#功能亮点)
- [惊喜模式](#惊喜模式)
- [快速开始](#快速开始)
- [使用提示](#使用提示)
- [架构](#架构)
- [技术栈](#技术栈)
- [开发](#开发)
- [路线图](#路线图)
- [开源与部署](#开源与部署)
- [参与贡献](#参与贡献)
- [FAQ](#faq)

---

## 界面预览

<div align="center">

![折角界面演示：书架与书页](docs/demo.gif?v=2)

<sub>惊喜模式 · 换一个顺序 · 书页划线 — 在本机 <code>http://127.0.0.1:8788</code> 录制</sub>

</div>

| 页面 | 做什么 |
| --- | --- |
| **书架** | 大数字概览 + 五种浏览方式，分组默认折叠 |
| **分组 / 分类** | 左侧导航、右侧书 grid，无限滚动 |
| **书页** | 按章节展示全部划线，可导出 Markdown / CSV |
| **划线** | 从划线里随机抽出能单独成句的句子 |
| **地图** | 按分类把阅读堆成可旋转的地形 |
| **手册** | 选至多 3 本书，写成七章人生手册 |
| **惊喜模式** | 随机打乱书序，「换一个顺序」重新洗牌 |

> 提示：首次访问可在导览最后一页点击「试试惊喜模式」一键体验。

---

## 为什么选择

| | 折角 | 只在微信读书 App |
| --- | --- | --- |
| 数据归属 | 本机 SQLite | 平台内 |
| 浏览视角 | 分组 / 进度 / 分类 / 推荐值 / 随机 | 单一列表 |
| 大书架 | 折叠 + 无限滚动 + 惊喜模式 | 长尾书难翻到 |
| 划线回看 | 按章节聚合，阅读栏宽优化 | 分散在 App 内 |
| 隐私 | Key 与数据不出本机 | — |

---

## 功能亮点

### 同步

- 同步在架书籍、阅读进度、划线（含章节结构）
- 已读完正确识别（`finishReading`），不再卡在 99%
- 单本失败不拖垮整架；失败项下次自动重试
- 后台补拉分类、推荐值；启动时刷新书架分组

### 多维书架

同一架书有五种看法，分组和分类是左右分栏：

- **分组** — 同步微信读书分组
- **进度** — 在读 / 未读 / 已读完
- **推荐值** — 神作、好评如潮等档位
- **分类** — 大类 + 子类筛选
- **随机** — 按进度分组 + 惊喜模式
- **搜索** — 书架以及分组 / 分类页可搜书名、作者
- **无限滚动** — 接近底部自动加载
- **本地缓存** — 打开先显示缓存，同步后刷新

### 阅读地图

导航「地图」（`/map`）按分类把划线数量铺成地形。可以按月份回放、拖动旋转、缩放、点开一座山看里面的书，并导出 PNG。分享出去的书架也有同一张地图。

### 章节划线

书页按章节列出这本书的全部划线，窄栏排版。可以返回书架，或跳到微信读书继续读。从划线页点进来时，会滚到对应的那一条。

### 导出

有划线的书页提供两个下载：

- Markdown：`/api/books/:bookId/export`
- CSV：`/api/books/:bookId/export?format=csv`

文件名取书名，内容按章节排列。

### 划线邂逅

导航上的名字是「划线」（`/encounter`）。它从已同步的划线里抽出能单独成句的句子。范围可以是所有书籍、已读完或进行中；看法可以是随机、分组或分类。点一条会打开那一章。分享书架也有这一页。

### 人生手册

导航「手册」（`/handbook`）。每次最多选 3 本书，按划线写成七章，可以手改章名和正文、重写一章、为这一章配图。旧手册留在历史里。生成和配图依赖本机已登录的 Cursor CLI（`agent`）；没有 CLI 时，已经写好的章节仍然可以读。

### 设计

- Apple 风格简约界面，宁静心流阅读体验
- 尊重 `prefers-reduced-motion`

---

## 惊喜模式

书架太深时，排序靠后的书可能永远不会被翻到。**惊喜模式**为此而生：

1. 打开书架顶部的 **惊喜模式** 开关
2. 每个分组内的书序会**随机排列**
3. 点击 **换一个顺序** 重新洗牌
4. 在「随机」浏览方式下会自动启用

适合：未读 4000+、想随缘重遇一本老书。

---

## 快速开始

### 环境

- **Node.js 20+**
- macOS / Linux（Windows 未专门测试）

### 三步跑起来

```bash
git clone https://github.com/lurui1997/read-life.git
cd read-life
npm install && npm start
```

浏览器打开 **http://127.0.0.1:8787**

```bash
# 指定端口
PORT=8788 npm start

# 开发模式（热更新）
npm run dev
```

### 配置 Key

1. 打开右上角 **设置**
2. 粘贴微信读书 **API Key** 并保存
3. 在设置里点击 **同步**

Key 写入 `data/read-life.sqlite`，不上传任何第三方。

> API Key 需来自你已有的微信读书 Agent / 开放平台能力。本项目通过 `POST https://i.weread.qq.com/api/agent/gateway` 调用官方接口。

---

## 使用提示

| 场景 | 建议 |
| --- | --- |
| 第一次同步 | 书多时需等待；设置页显示进度 |
| 书太多翻不到 | 开惊喜模式，或切到「随机」 |
| 读划线 | 点书卡进入书页 |
| 全量刷新 | 设置里「强制同步」 |
| 重温功能 | 设置里「打开功能导览」 |

---

## 架构

<div align="center">

![架构示意：浏览器 → Hono API → 同步引擎 / SQLite → 微信读书 Gateway](docs/architecture.svg)

</div>

```text
read-life/
├── src/server/    # API、同步、数据库
├── src/web/       # React 书架 · 书页 · 导览
├── src/shared/    # 类型与共享逻辑
├── test/          # Vitest
└── data/          # SQLite（gitignore）
```

---

## 技术栈

| 层级 | 选型 |
| --- | --- |
| 运行时 | Node.js + TypeScript |
| 服务端 | [Hono](https://hono.dev/) |
| 数据库 | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| 前端 | React 19 + Vite |
| 测试 | Vitest |

---

## 开发

```bash
npm test              # 测试
npx tsc --noEmit      # 类型检查
npm run build         # 构建前端
```

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址。容器里设为 `0.0.0.0`，端口才能映射出来 |
| `READ_LIFE_DB` | `data/read-life.sqlite` | 数据库路径 |
| `NODE_ENV` | — | `production` 时服务静态资源 |
| `LOCAL_AUTH` | `off` | `on` 时必须注册登录，书架按用户隔离 |
| `SESSION_SECRET` | 开发占位 | `LOCAL_AUTH=on` 时必填，用于会话 |
| `WEREAD_SECRET` | — | `LOCAL_AUTH=on` 时必填，加密保存 API Key |
| `COOKIE_SECURE` | `off` | HTTPS 部署时设为 `on` |

---

## 路线图

已经在代码里：

- [x] 导出划线（Markdown / CSV）
- [x] 多维书架，以及书名、作者搜索
- [x] 阅读地图
- [x] 划线邂逅（导航「划线」，`/encounter`）
- [x] 人生手册

还没有：

- [ ] 划线全文搜索
- [ ] 独立的阅读统计页（书页已显示进度、时长和划线条数）

**本机默认单用户**（`LOCAL_AUTH=off`）。公网部署设置 `LOCAL_AUTH=on`，并用 `SESSION_SECRET`、`WEREAD_SECRET` 开启注册登录与扫码绑定。有声书、书评仍不做。近期维护见 [docs/MAINTENANCE.md](docs/MAINTENANCE.md)。

---

## 开源与部署

| | |
| --- | --- |
| 许可证 | [MIT](LICENSE)，版权 **lurui1997 / 言七**。`package.json` 的 `license` 为 `MIT`，仓库可以当开源项目安装 |
| 持续集成 | [`.github/workflows/ci.yml`](.github/workflows/ci.yml)：推送或 Pull Request 到 `main` 时，用 Node.js 20 执行 `npm ci`、`npm test`、`npx tsc --noEmit` |
| 维护 | [docs/MAINTENANCE.md](docs/MAINTENANCE.md)：贡献流程、Issue / PR 约定、近期计划 |
| 示例 | <https://read-life.aikipedia.cn/> |

### Docker

镜像默认基于国内源 `docker.1ms.run/library/node:20-bookworm-slim`，避免拉取 Docker Hub 超时。官方镜像是 `node:20-bookworm-slim`，构建时用 `NODE_IMAGE` 换掉即可。容器监听 `0.0.0.0:8787`，数据库和手册图片放在挂载的 `data/`。

```bash
# 国内镜像（Dockerfile 默认）
docker build -t read-life .

# 官方 Node 镜像
docker build --build-arg NODE_IMAGE=node:20-bookworm-slim -t read-life .

docker run --rm -p 8787:8787 -v "$(pwd)/data:/data" read-life
```

一条命令（同样默认国内镜像）：

```bash
docker compose up --build
```

改用官方镜像：

```bash
NODE_IMAGE=node:20-bookworm-slim docker compose up --build
```

浏览器打开 **http://127.0.0.1:8787**。`data/` 已在 `.gitignore` 里，不要把书架数据库提交进仓库。

---

## 参与贡献

Issue 和 Pull Request 都欢迎。流程见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [docs/MAINTENANCE.md](docs/MAINTENANCE.md)。

1. Fork 本仓库
2. 创建分支：`git checkout -b feat/your-feature`
3. 提交改动并推送到分支
4. 发起 Pull Request，并确认 CI 通过

如果这个项目对你有帮助，欢迎 **Star** 支持，也欢迎 **Fork** 按自己的习惯改造。

[![Star History Chart](https://api.star-history.com/svg?repos=lurui1997/read-life&type=Date)](https://star-history.com/#lurui1997/read-life&Date)

---

## FAQ

**Q：数据存在哪里？**  
A：本机 `data/read-life.sqlite`，可备份此文件迁移。

**Q：Key 安全吗？**  
A：Key 只存在本机 SQLite，页面不会把它发到除微信读书 gateway 以外的服务。

**Q：同步很慢？**  
A：书架越大越久；单本失败不影响其他书，下次同步会重试。

**Q：惊喜模式和「随机」有什么区别？**  
A：「随机」是浏览方式，默认开惊喜模式；其他视图也可单独打开惊喜模式开关。

**Q：为什么已读完显示 99%？**  
A：已修复：同步 `finishReading` 后归一化为 100% /「已读完」。

---

## 致谢

灵感来自「**阅读数据应该属于读者自己**」—— 微信读书负责读，折角负责把痕迹留在本机。

---

<p align="center">
  <sub>Made with calm · 按自己的节奏浏览，不必一次看完。</sub>
</p>

<p align="center">
  <a href="https://github.com/lurui1997/read-life/stargazers">⭐ Star</a>
  ·
  <a href="https://github.com/lurui1997/read-life/fork">🍴 Fork</a>
  ·
  <a href="https://github.com/lurui1997/read-life/issues">💬 Issue</a>
</p>
