# 折角 · Obsidian

把微信读书的书架和划线留在当前库里。做法参照 [obsidian-weread-plugin](https://github.com/lurui1997/obsidian-weread-plugin)：侧边栏入口、命令、设置页，以及按书写成的 Markdown。

这一版跟着折角的读法，而不是那套模板系统：

- 有划线的书各一篇笔记，按章节排成引用，每条划线有块编号，可以链出去
- 书架按微信读书的分组折叠，可搜书名和作者
- 「划线」从能单独成句的句子里抽三条，点开跳到对应笔记
- 计数没变的书下次同步会跳过；强制同步会重拉

划线或进度变了，同步会覆盖生成的正文；强制同步也会。要自己写，加这一行，把它下面的内容留下：

```markdown
%% read-life:user %%
```

只同步你自己的书架和划线，不下载正文。手册和地图仍在网页版。

## 安装

需要 Node.js 20+。

```bash
cd obsidian
npm install
npm run build
mkdir -p "<vault>/.obsidian/plugins/read-life"
cp manifest.json main.js styles.css "<vault>/.obsidian/plugins/read-life/"
```

在 Obsidian 里关闭安全模式，启用「折角」。设置里用微信扫码绑定，和网页版一样。扫码失败时，高级选项里可以粘贴 API Key，保存前会先向微信读书确认。

开发时在 `obsidian/` 里运行 `npm run dev`，它会盯着源码重新打包。

## 笔记长什么样

Frontmatter 里有 `bookId`、进度、分组和标签 `折角`。可以用 Dataview 列出来：

```dataview
TABLE author, progress, highlightCount
FROM #折角
SORT progress DESC
```

从书架拿掉的书会从折角面板消失，已经写下的笔记还留在目录里。改笔记目录之后再同步，新文件写到新目录。

索引在插件目录的 `catalog.json`。它坏了可以删掉再同步；笔记还在，同步时会按 `bookId` 认领原来的文件。
