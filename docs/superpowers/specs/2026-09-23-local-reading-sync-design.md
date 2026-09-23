# 本机阅读同步：设计

第一版是给一个人在本机用的网页。贴上微信读书 API Key 之后，同步书架上的书、划线和阅读进度，在书架和书页里回看。数据和 Key 都留在这台电脑上。

这一版不做：有声书、文章收藏、想法、书评、热门划线、阅读统计、「今天」页、Cookie 登录、多用户。

## 架构

本机只跑一个进程。浏览器只访问 localhost。API Key 存在本机 SQLite，由服务端带 `Authorization: Bearer` 调用 `POST https://i.weread.qq.com/api/agent/gateway`。

四个单元：

| 单元 | 职责 | 依赖 |
| --- | --- | --- |
| 网页 | 粘贴 Key、触发同步、展示书架和书页 | 只调用本机 HTTP |
| 本机 HTTP | 保存 Key、启动同步、读取本地书 | 同步、数据库 |
| 同步 | 按 `bookId` 写入；单本失败继续 | 微信读书客户端、数据库 |
| 微信读书客户端 | 把 gateway 请求发到微信读书 | 无本地状态 |
| 数据库 | 书、章节、划线、同步记录、Key | 无 |

技术选择：TypeScript、Node、Hono、better-sqlite3、Vite、React。开发时一个命令同时提供 API 和页面，页面请求发到同一来源。数据库文件是 `data/read-life.sqlite`，不进版本库。

## 远端接口

只用这四个 `api_name`：

| 接口 | 用途 |
| --- | --- |
| `/shelf/sync` | 取顶层 `books` 数组。每本书用 `bookId`、`title`、`author`、`cover`、`readUpdateTime`。不用 `albums`、`mp`、`archive`，也不用 `finishReading` |
| `/user/notebooks` | 分页读取顶层 `books` 数组。每项的 `noteCount` 是划线数，`sort` 是翻页游标。`hasMore=1` 时，用本页最后一条的 `sort` 作为下次的 `lastSort`。不用该项里的 `readingProgress` |
| `/book/bookmarklist` | 一本书的划线。以本次响应的 `updated` 作为该书全部划线，并用其中的 `chapters` 作为这些划线的章节。划线用 `bookmarkId`、`chapterUid`、`markText`、`range` |
| `/book/getprogress` | 读 `book.progress`（0–100 的百分比）和 `book.readingTime`（秒） |

不调用章节目录、想法、热门划线和阅读统计接口。

每次 gateway 请求都是 `POST`，JSON 顶层平铺，并带 `skill_version` 为 `"1.0.3"`。例如 `{ "api_name": "/book/getprogress", "bookId": "695233", "skill_version": "1.0.3" }`。业务参数不嵌套。响应 `errcode` 非 0 视为这次请求失败。笔记本分页的 `count` 为 20。

## 同步

`POST /api/sync` 在后台启动一次同步，并立刻返回当前状态，不等到同步结束。`GET /api/sync` 返回同一形状，供页面轮询。`running` 只存在于进程内存里。同步记录在这次结束时才写入数据库。进程中途退出不会留下「正在同步」的锁，下次可以再启动。已有同步在跑时，再次 `POST`（含 `?force=1`）不重入，直接返回当前状态。`POST /api/sync?force=1` 在没有同步在跑时是强制同步，同样立刻返回。

状态形状：

```json
{
  "running": true,
  "last": null
}
```

`last` 是上一次已经结束的同步记录；还没有结束过则为 `null`。同步结束时 `running` 变为 `false`，`last` 换成这一次的记录：

```json
{
  "running": false,
  "last": {
    "startedAt": "2026-09-23T08:00:00.000Z",
    "finishedAt": "2026-09-23T08:00:12.000Z",
    "shelfCount": 10,
    "updated": 2,
    "skipped": 7,
    "failed": 1,
    "message": "",
    "errors": [{ "bookId": "695233", "message": "getprogress failed" }]
  }
}
```

时间是 ISO 8601 字符串。`message` 是清单级失败的原因，成功时为 `""`。`errors` 是单本失败。没有已保存的 Key 时，`POST` 不启动同步，返回 `{ "error": "尚未配置 API Key" }`，不写库。

### 先取清单，再写库

1. 没有已保存的 Key：不启动同步，不写库。
2. 请求 `/shelf/sync` 和全部分页的 `/user/notebooks`。其中任一失败（含 Key 被拒绝）：不修改书、划线、进度、在架状态。写入一条已结束的同步记录，计数都是 0，`errors` 为空，`message` 写明原因。页面通过 `GET /api/sync` 看到它。
3. 两份清单都成功之后，才进入写入。结束后的记录 `message` 为空。

笔记本里没有的书，划线数按 0。

### 每本书写什么

身份是 `bookId`。展示用的书名可以重复。

进度和划线只处理本次 `/shelf/sync` 的 `books`。不在这份列表里的已有书只设为不在架，不请求进度，也不请求划线。书架本数等于这份 `books` 的长度，并且等于更新、跳过、失败之和。

书架写入：更新书名、作者、封面 URL、展示用的 `readUpdateTime`。不另存「是否读完」。本次 `books` 里没有、库里已有的书设为不在架。不删除它们的划线和进度。封面使用书架返回的 URL，浏览器直接加载该图片。这只是图片地址，不携带 API Key。

进度是否重拉，比较的是本次书架返回的 `readUpdateTime` 和「上次 `/book/getprogress` 成功时记下的游标」。展示用的 `readUpdateTime` 可以先写入，它不充当这个游标。游标有三种状态：还没成功过、成功时记下的秒数、成功时书架没有 `readUpdateTime`。没有 `readUpdateTime` 和没有 `readUpdateTime` 视为相同；一边有秒数、一边没有，视为不同。

- 还没有成功过，或本次值与游标不同：请求 `/book/getprogress`，写入进度百分比和阅读秒数。只有这次写入成功，才把游标更新为本次的值（有秒数就记下秒数，没有就记下「成功时没有时间」）。
- 请求失败：不改进度，不推进游标。下一轮仍会重试。
- 游标相同：跳过。
- 强制同步不跳过。成功后同样把游标更新为本次的值。

划线挂在章节上，关联字段是 `chapterUid`。

- 本地还没有「划线已同步」标记，或者远端 `noteCount` 与本地保存的跳过用划线数不同：请求 `/book/bookmarklist`，在一个事务里用 `updated` 整本替换划线，并用响应里的 `chapters` 替换这些章节。本次响应里没有的旧章节一并删除。
- 跳过用划线数相同且已经同步过：跳过。远端 `noteCount` 从 5 变成 0 时要拉一次，替换结果可以是空。
- 强制同步不跳过。
- 不因为 `reviewCount` 变化去重拉划线。想法不在这一版。

一次成功的替换会记下「划线已同步」，并把跳过用划线数设为这次清单里的 `noteCount`，即使 `updated` 是空的。下一轮只用这个数和最新的远端 `noteCount` 比较。页面上的 `highlightCount` 是库里实际保存的划线条数，也就是这次 `updated` 的条数，不使用 `noteCount`。两者不一致时，卡片和书页按实际条数显示，跳过判断仍用 `noteCount`。请求失败不清除旧划线，不改跳过用划线数，也不把标记改成已同步。

### 计数

每本书的进度和划线各自是跳过、写入或失败。

- 任一侧失败：这本书计入失败。另一侧如果已经成功，仍然保留那次写入。同一本书两侧都失败时，`errors` 有两条，失败本数仍加 1。
- 两侧都没有失败，且至少一侧写入：计入更新。
- 两侧都跳过：计入跳过。

结束后写入一条同步记录，字段与 `GET /api/sync` 的 `last` 相同。

## 网页怎么读

页面只读本地库。

`GET /api/key` 只返回 `{ "configured": true }` 或 `{ "configured": false }`，不返回 Key。`PUT /api/key` 的正文是 `{ "apiKey": "..." }`。它用一次 `{ "api_name": "/user/notebooks", "count": 1, "skill_version": "1.0.3" }` 确认鉴权。失败则不替换已保存的 Key，返回 `{ "error": "API Key 无效" }`。成功才写入，返回 `{ "configured": true }`。

`GET /api/books` 只列出在架的书，由服务端分组后返回：

```json
{
  "groups": [
    {
      "year": "2026",
      "books": [
        {
          "bookId": "695233",
          "title": "三体",
          "author": "刘慈欣",
          "cover": "https://example.com/cover.jpg",
          "readUpdateTime": 1712799586,
          "progress": 15,
          "readingTimeSeconds": 28223,
          "highlightCount": 2
        }
      ]
    }
  ]
}
```

分组键是 `readUpdateTime` 的本地日历年份。年份组按年份从新到旧排列，2026 在 2025 前面。组内按该时间倒序。没有 `readUpdateTime` 的书归入 `year` 为「未知」的组，这一组排在所有年份组后面。进度还没有成功同步过时，`progress` 和 `readingTimeSeconds` 为 `null`，卡片显示未同步。不用笔记本列表里的 `readingProgress` 代替。`highlightCount` 是库里实际保存的划线条数，不是远端 `noteCount`。

`GET /api/books/:bookId` 对已入库的书都可用，包括当前不在架的书。库里没有这本书时返回 404。响应示例：

```json
{
  "bookId": "695233",
  "title": "三体",
  "author": "刘慈欣",
  "cover": "https://example.com/cover.jpg",
  "onShelf": true,
  "progress": 15,
  "readingTimeSeconds": 28223,
  "highlightCount": 2,
  "chapters": [
    {
      "chapterUid": 108,
      "chapterIdx": 23,
      "title": "15 红岸之四",
      "highlights": [
        {
          "bookmarkId": "695233_19_3760-3894",
          "markText": "地球生命真的是宇宙中偶然里的偶然。",
          "range": "3450-3584"
        }
      ]
    }
  ]
}
```

划线嵌在所属章节的 `highlights` 里，不与章节平铺。页面展示章节标题和划线原文，不展示划线创建时间。章按 `chapterIdx` 升序，章内按 `range` 起点升序。`range` 的格式是 `"起始-结束"`，起点是连字符前的整数。缺 `range`，或起点不能解析成整数的划线，排在该章最后。没有划线时头部仍在，`chapters` 为空数组。

返回给网页的任何 JSON 都不含 API Key。

## 失败

| 情况 | 库 | 页面 |
| --- | --- | --- |
| 没有 Key | 不写库，不启动同步 | `POST` 返回尚未配置 |
| 清单请求失败 | 书、划线、进度、在架状态不变 | `GET /api/sync` 的 `last.message` 显示原因 |
| 某一本的进度或划线请求失败 | 该本保留上一次成功的内容；其他书照常写入 | 同步结果里有失败本数和原因 |
| 书不在本次成功返回的书架里 | 书架隐藏，划线保留 | 书架不列出；直接打开该书仍能看到留存内容 |
| 同步进行中又触发一次 | 不重入 | 看到当前这次的状态 |

## 测试

测试使用保存的接口响应，不访问微信读书。

必须覆盖：

- 划线数和 `readUpdateTime` 都没变，且两边都已经同步过：两个详情请求都不发。
- 划线数变化：整本替换划线；远端 `noteCount` 从有到 0 会清空划线。`noteCount` 与 `updated` 条数不一致时，页面上的 `highlightCount` 等于 `updated` 条数，下一轮跳过仍比较 `noteCount`。
- `readUpdateTime` 变化：更新进度；没变且已有进度：不更新。
- 强制同步：即使计数和时间都没变，也重拉划线和进度。
- 一本书的请求失败：其他书仍然写入；失败的那一本保留旧内容；同步记录计入失败。
- 书架或笔记本列表失败：书、划线、进度、在架状态都不变；同步记录只带 `message`，计数为 0。
- 进度请求失败后，展示用的 `readUpdateTime` 已更新，但进度游标未推进：下一轮仍请求 `/book/getprogress`。
- 书架请求成功且某书缺席：该书不在架，划线还在，按 id 仍能读到。
- 书页排序：章节序号，然后是 `range` 起点。
- 书架分组：年份从新到旧；组内按最近阅读时间倒序；没有时间的归入「未知」，排在最后。
- 没有 `readUpdateTime` 的书，进度成功一次之后，下一轮不再请求 `/book/getprogress`，直到书架给出了时间。
- 不在本次书架列表里的书只改为不在架，不请求划线和进度。
- 网页接口的响应里没有 API Key。保存 Key 的鉴权失败时，旧 Key 还在。
