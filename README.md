# 阅读生活

> 把微信读书的书架、划线和进度，留在自己的电脑上慢慢看。

[![GitHub stars](https://img.shields.io/github/stars/lurui1997/read-life?style=social)](https://github.com/lurui1997/read-life/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/lurui1997/read-life?style=social)](https://github.com/lurui1997/read-life/network/members)

**阅读生活**是一个跑在本机的阅读同步站：贴上微信读书 API Key，一键同步书架与划线，在浏览器里按自己的节奏浏览、回看、邂逅久违的好书。

数据在本地，Key 在本地，不依赖云端账号体系。适合书架上千本、想拥有「自己的阅读档案」的读者。

---

## 为什么选择阅读生活

| | 阅读生活 | 只在微信读书里看 |
| --- | --- | --- |
| 数据归属 | SQLite 落盘在本机 | 平台内 |
| 浏览方式 | 分组 / 进度 / 分类 / 推荐值 / 惊喜模式 | 单一列表 |
| 划线回看 | 按章节聚合，阅读栏宽优化 | 分散在 App 内 |
| 大书架 | 无限滚动 + 默认折叠，不压视线 | 长尾书难翻到 |
| 隐私 | Key 与数据不出本机 | — |

---

## 功能亮点

### 同步与存储

- 同步**在架书籍**、**阅读进度**、**划线**（含章节结构）
- 已读完的书正确识别（`finishReading`），不再卡在 99%
- 单本失败不拖垮整架；进度失败时游标不推进，下次继续
- 后台补拉分类、推荐值；启动时刷新书架分组

### 书架浏览

- **分组** — 同步微信读书书架分组，左右分栏浏览
- **进度** — 在读 / 未读 / 已读完，默认折叠，点开再看
- **推荐值** — 按神作、好评如潮等档位浏览
- **分类** — 按书籍分类筛选，支持子类过滤
- **随机** — 惊喜模式随机排列，邂逅深处的书
- **惊喜模式** — 任意视图下一键打乱书序，「换一个顺序」重新洗牌
- **无限滚动** — 下拉自动加载，无需点「加载更多」
- 书架缓存：打开页面先显示本地缓存，同步完成后刷新

### 书页阅读

- 按章节展示全部划线，排版为**宁静心流**阅读体验
- 一行返回书架，一键跳转微信读书继续读

### 设计

- 简约大气的界面，大数字书架概览，轻量顶栏操作
- 尊重 `prefers-reduced-motion`，减少动效干扰

---

## 快速开始

### 环境要求

- Node.js 20+
- macOS / Linux（Windows 未专门测试，理论可用）

### 安装与运行

```bash
git clone https://github.com/lurui1997/read-life.git
cd read-life
npm install
npm start
```

浏览器打开 **http://127.0.0.1:8787**。

指定端口（例如 8788）：

```bash
PORT=8788 npm start
```

开发模式（热更新）：

```bash
npm run dev
```

### 配置 API Key

1. 打开页面右上角 **设置**
2. 粘贴你的**微信读书 API Key**
3. 保存后回到书架，点击 **同步**

Key 只写入本机 SQLite（`data/read-life.sqlite`），不会上传到任何第三方服务。

> 如何获取 API Key：请使用你已在用的微信读书开放平台 / Agent 能力。本项目通过 `POST https://i.weread.qq.com/api/agent/gateway` 调用官方接口。

---

## 使用提示

1. **第一次同步** — 书架上书较多时，同步会持续一段时间；顶栏会显示进度，失败的书下次会自动重试。
2. **大分组** — 打开「惊喜模式」，让排在后面的书也有机会被看到。
3. **读划线** — 点击任意书籍卡片进入书页；章节标题下即该章全部划线。
4. **强制同步** — 需要全量刷新时使用顶栏「强制同步」。

---

## 技术栈

| 层级 | 选型 |
| --- | --- |
| 运行时 | Node.js + TypeScript |
| 服务端 | [Hono](https://hono.dev/) |
| 数据库 | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| 前端 | React 19 + Vite |
| 测试 | Vitest |

本机单进程：开发时 Vite 与 API 同源；生产模式下 `npm start` 会先构建前端再启动服务。

---

## 项目结构

```
read-life/
├── src/
│   ├── server/     # HTTP API、同步、数据库
│   ├── web/        # React 书架与书页
│   └── shared/     # 类型与共享逻辑
├── test/           # 单元与集成测试
├── data/           # SQLite（gitignore，运行时生成）
└── docs/           # 设计说明
```

---

## 开发

```bash
# 运行测试
npm test

# 类型检查
npx tsc --noEmit

# 生产构建
npm run build
```

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `READ_LIFE_DB` | `data/read-life.sqlite` | 数据库路径 |
| `NODE_ENV` | — | `production` 时服务静态构建产物 |

---

## 路线图

- [ ] 导出划线（Markdown / CSV）
- [ ] 搜索书名与划线全文
- [ ] 阅读统计与「今天读了什么」

**刻意不做**：多用户、Cookie 登录、有声书、书评、热门划线、云端托管。

---

## 参与贡献

欢迎 Issue 和 Pull Request。

如果这个项目对你有帮助，欢迎 **Star** 支持一下，也欢迎 **Fork** 按自己的习惯改造。

[![Star History Chart](https://api.star-history.com/svg?repos=lurui1997/read-life&type=Date)](https://star-history.com/#lurui1997/read-life&Date)

---

## 致谢

灵感来自「阅读数据应该属于读者自己」—— 微信读书负责读，**阅读生活**负责把痕迹留在本机。

---

<p align="center">
  <sub>Made with calm · 按自己的节奏浏览，不必一次看完。</sub>
</p>
