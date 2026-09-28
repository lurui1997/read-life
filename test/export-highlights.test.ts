import { describe, expect, it } from 'vitest'
import { createApp } from '../src/server/app'
import { contentDisposition, exportFilename, highlightsToCsv, highlightsToMarkdown } from '../src/shared/export-highlights'
import type { BookDetail } from '../src/shared/types'
import { fakeWeread, shelfBook, tempDb } from './helpers'

const book: BookDetail = {
  bookId: '1',
  title: '窗边',
  author: '某人',
  cover: '',
  onShelf: true,
  progress: 40,
  readingTimeSeconds: 10,
  finishReading: false,
  highlightCount: 2,
  wereadUrl: 'https://weread.qq.com/web/reader/1',
  chapters: [
    {
      chapterUid: 2,
      chapterIdx: 2,
      title: '夜',
      highlights: [{ bookmarkId: 'b', markText: '他把窗打开，夜里的风进来了。', range: null }],
    },
    {
      chapterUid: 1,
      chapterIdx: 1,
      title: '昼',
      highlights: [{ bookmarkId: 'a', markText: '他说："留下。"', range: null }],
    },
  ],
}

describe('单本划线导出', () => {
  it('Markdown 按章节引用原文', () => {
    expect(highlightsToMarkdown(book)).toBe(`# 窗边

某人

## 夜

> 他把窗打开，夜里的风进来了。

## 昼

> 他说："留下。"
`)
  })

  it('CSV 带表头，引号和逗号被包起来', () => {
    const csv = highlightsToCsv({
      ...book,
      chapters: [{
        chapterUid: 1,
        chapterIdx: 1,
        title: '昼',
        highlights: [{ bookmarkId: 'a', markText: '他说："a,b"', range: null }],
      }],
    })
    expect(csv.startsWith('\uFEFF书名,作者,章节,划线\n')).toBe(true)
    expect(csv).toContain('"他说：""a,b"""')
  })

  it('文件名去掉路径字符', () => {
    expect(exportFilename('a/b:c', 'md')).toBe('a b c 划线.md')
    expect(contentDisposition('窗边 划线.md')).toContain("filename*=UTF-8''")
  })

  it('接口下载这一本的 Markdown，找不到书时 404', async () => {
    const db = tempDb()
    db.upsertShelfBook(shelfBook({ bookId: '1', title: '窗边' }))
    db.replaceHighlights('1', 1, [{ chapterUid: 4, chapterIdx: 1, title: '夜' }], [
      { bookmarkId: 'line', chapterUid: 4, markText: '他把窗打开，夜里的风进来了。', range: null },
    ])
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    const response = await app.request('/api/books/1/export')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(response.headers.get('content-disposition')).toContain('filename*=UTF-8\'\'')
    expect(await response.text()).toContain('> 他把窗打开，夜里的风进来了。')
    const missing = await app.request('/api/books/missing/export')
    expect(missing.status).toBe(404)
    db.close()
  })
})
