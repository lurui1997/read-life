# 维护与路线

折角（read-life）由 **lurui1997 / 言七** 维护。许可证是 [MIT](../LICENSE)。线上示例：<https://read-life.aikipedia.cn/>。

## 贡献流程

1. Fork 本仓库，从 `main` 拉出分支，例如 `feat/highlight-search`。
2. 改动保持在一个问题上。不要提交 `data/` 里的 SQLite、手册图片、API Key、`.env` 或会话密钥。
3. 本地跑过：

   ```bash
   npm test
   npx tsc --noEmit
   ```

4. 向 `main` 发起 Pull Request。说明改了什么、怎么验证。界面改动请写明点过的路径。
5. `.github/workflows/ci.yml` 会在推送到 `main` 以及针对 `main` 的 Pull Request 上执行：Node.js 20、`npm ci`、`npm test`、`npx tsc --noEmit`。CI 没过不合并。

Issue 请用仓库里的模板：缺陷写复现步骤和期望，功能建议写动机。中英文都可以。一个 Issue 只讲一件事。

## 维护约定

- 本机默认单用户（`LOCAL_AUTH=off`）。公网部署才打开注册登录，并设置 `SESSION_SECRET` 与 `WEREAD_SECRET`。
- 有声书、书评不在范围内。
- 依赖升级单独开 Pull Request，并附上 `npm test` 结果。
- 合并后由维护者查看 Issue 与 Pull Request。没有固定响应时限；带复现步骤的缺陷优先。

## 近期计划

这些是代码里已经露出边界、接下来会继续做的事：

- **划线全文搜索。** 书架和分组/分类页已经能搜书名、作者。划线正文还不能搜。
- **阅读统计。** 书页已有进度、阅读时长和划线条数。还没有独立的统计页。
- **主题归纳接到导航。** `/api/themes` 与 `src/web/Themes.tsx` 已能按分类、分组或最近阅读归纳划线，并支持改名、合并、挪句。这个页面还没挂进主导航。
- **保持 CI 与 Docker 可重复。** 推送和 Pull Request 走 GitHub Actions；本地一条 `docker compose up --build` 能打开服务。

## 更长的方向

继续把阅读数据留在读者自己的机器上：同步、书架、划线、地图和手册都以本机 SQLite 为准。新能力先补测试，再写进 README，避免文档超前于代码。
