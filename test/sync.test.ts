import { describe, expect, it } from 'vitest'
import { runSync } from '../src/server/sync'
import { fakeWeread, highlights, localTimestamp, notebookPage, progress, shelfBook, tempDb } from './helpers'

const chapter = { chapterUid: 108, chapterIdx: 23, title: '15 红岸之四' }

function library(options?: {
  books?: ReturnType<typeof shelfBook>[]
  notes?: Array<{ bookId: string; noteCount: number; sort: number }>
  onHighlight?: (bookId: string) => unknown
  onProgress?: (bookId: string) => unknown
}) {
  const books = options?.books ?? [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: localTimestamp(2026) })]
  const notes = options?.notes ?? books.map((book, index) => ({ bookId: book.bookId, noteCount: 1, sort: index + 1 }))
  return fakeWeread({
    '/shelf/sync': () => ({ books }),
    '/user/notebooks': () => notebookPage(notes),
    '/book/getprogress': (params) => (options?.onProgress ?? (() => progress(15, 100)))(String(params.bookId)),
    '/book/bookmarklist': (params) =>
      (options?.onHighlight ??
        (() =>
          highlights('695233', [{ bookmarkId: 'h1', chapterUid: 108, markText: '原文', range: '10-20' }], [chapter])))(
        String(params.bookId),
      ),
  })
}

describe('同步', () => {
  it('计数和时间都没变时不再请求划线和进度', async () => {
    const db = tempDb()
    const first = library()
    await runSync(db, first, { force: false })
    const second = library()
    await runSync(db, second, { force: false })
    expect(second.calls.map((call) => call.apiName)).toEqual(['/shelf/sync', '/user/notebooks'])
    db.close()
  })

  it('没有划线的书不请求划线列表', async () => {
    const db = tempDb()
    const client = library({ notes: [{ bookId: '695233', noteCount: 0, sort: 1 }] })
    await runSync(db, client, { force: false })
    expect(client.calls.map((call) => call.apiName)).not.toContain('/book/bookmarklist')
    expect(db.getBook('695233')?.highlightsSynced).toBe(true)
    expect(db.getBookDetail('695233')?.highlightCount).toBe(0)
    db.close()
  })

  it('划线数变化时整本替换，从有到 0 会清空', async () => {
    const db = tempDb()
    await runSync(db, library({ notes: [{ bookId: '695233', noteCount: 1, sort: 1 }] }), { force: false })
    expect(db.getBookDetail('695233')?.highlightCount).toBe(1)
    await runSync(
      db,
      library({
        notes: [{ bookId: '695233', noteCount: 0, sort: 1 }],
        onHighlight: () => highlights('695233', [], []),
      }),
      { force: false },
    )
    expect(db.getBookDetail('695233')?.highlightCount).toBe(0)
    expect(db.getBookDetail('695233')?.chapters).toEqual([])
    db.close()
  })

  it('noteCount 与实际条数不一致时，页面按实际条数，下次仍按 noteCount 跳过', async () => {
    const db = tempDb()
    await runSync(
      db,
      library({
        notes: [{ bookId: '695233', noteCount: 5, sort: 1 }],
        onHighlight: () => highlights('695233', [{ bookmarkId: 'only', chapterUid: 108, markText: '仅一条', range: '1-2' }], [chapter]),
      }),
      { force: false },
    )
    expect(db.getBookDetail('695233')?.highlightCount).toBe(1)
    const again = library({ notes: [{ bookId: '695233', noteCount: 5, sort: 1 }] })
    await runSync(db, again, { force: false })
    expect(again.calls.map((call) => call.apiName)).not.toContain('/book/bookmarklist')
    db.close()
  })

  it('最近阅读时间变化才更新进度', async () => {
    const db = tempDb()
    const time = localTimestamp(2026)
    await runSync(db, library({ books: [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: time })] }), { force: false })
    const same = library({
      books: [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: time })],
      onProgress: () => progress(90, 999),
    })
    await runSync(db, same, { force: false })
    expect(same.calls.map((call) => call.apiName)).not.toContain('/book/getprogress')
    expect(db.getBook('695233')?.progress).toBe(15)

    const next = localTimestamp(2026, 8, 2)
    await runSync(
      db,
      library({
        books: [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: next })],
        onProgress: () => progress(40, 500),
      }),
      { force: false },
    )
    expect(db.getBook('695233')?.progress).toBe(40)
    expect(db.getBook('695233')?.readingTimeSeconds).toBe(500)
    db.close()
  })

  it('强制同步会重拉划线和进度', async () => {
    const db = tempDb()
    await runSync(db, library(), { force: false })
    const forced = library({ onProgress: () => progress(3, 9) })
    await runSync(db, forced, { force: true })
    expect(forced.calls.map((call) => call.apiName)).toContain('/book/getprogress')
    expect(forced.calls.map((call) => call.apiName)).toContain('/book/bookmarklist')
    expect(db.getBook('695233')?.progress).toBe(3)
    db.close()
  })

  it('一本书失败时其他书仍然写入，失败本保留旧内容', async () => {
    const db = tempDb()
    const time = localTimestamp(2026)
    const books = [
      shelfBook({ bookId: 'a', title: '甲', readUpdateTime: time }),
      shelfBook({ bookId: 'b', title: '乙', readUpdateTime: time }),
    ]
    await runSync(
      db,
      library({
        books,
        notes: [
          { bookId: 'a', noteCount: 1, sort: 1 },
          { bookId: 'b', noteCount: 1, sort: 2 },
        ],
        onHighlight: (bookId) => highlights(bookId, [{ bookmarkId: `${bookId}-1`, chapterUid: 108, markText: bookId, range: '1-2' }], [chapter]),
        onProgress: () => progress(10, 20),
      }),
      { force: false },
    )
    const moved = localTimestamp(2026, 9, 1)
    const record = await runSync(
      db,
      library({
        books: [
          shelfBook({ bookId: 'a', title: '甲', readUpdateTime: moved }),
          shelfBook({ bookId: 'b', title: '乙改', readUpdateTime: moved }),
        ],
        notes: [
          { bookId: 'a', noteCount: 1, sort: 1 },
          { bookId: 'b', noteCount: 1, sort: 2 },
        ],
        onProgress: (bookId) => {
          if (bookId === 'a') throw new Error('getprogress failed')
          return progress(80, 800)
        },
      }),
      { force: false },
    )
    expect(record.failed).toBe(1)
    expect(record.updated).toBe(1)
    expect(record.shelfCount).toBe(2)
    expect(record.errors).toEqual([{ bookId: 'a', message: '进度同步失败' }])
    expect(db.getBook('a')?.progress).toBe(10)
    expect(db.getBook('a')?.readUpdateTime).toBe(moved)
    expect(db.getBook('b')?.title).toBe('乙改')
    expect(db.getBook('b')?.progress).toBe(80)
    db.close()
  })

  it('进度失败后游标不推进，下一轮仍请求进度', async () => {
    const db = tempDb()
    const time = localTimestamp(2026)
    await runSync(db, library({ books: [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: time })] }), { force: false })
    const moved = localTimestamp(2026, 9, 3)
    await runSync(
      db,
      library({
        books: [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: moved })],
        onProgress: () => {
          throw new Error('down')
        },
      }),
      { force: false },
    )
    expect(db.getBook('695233')?.readUpdateTime).toBe(moved)
    expect(db.getBook('695233')?.progress).toBe(15)
    const retry = library({
      books: [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: moved })],
      onProgress: () => progress(22, 222),
    })
    await runSync(db, retry, { force: false })
    expect(retry.calls.map((call) => call.apiName)).toContain('/book/getprogress')
    expect(db.getBook('695233')?.progress).toBe(22)
    db.close()
  })

  it('两侧都失败时记两条原因，失败本数仍是 1', async () => {
    const db = tempDb()
    await runSync(db, library(), { force: false })
    const record = await runSync(
      db,
      library({
        onProgress: () => {
          throw new Error('p')
        },
        onHighlight: () => {
          throw new Error('h')
        },
      }),
      { force: true },
    )
    expect(record.failed).toBe(1)
    expect(record.errors).toHaveLength(2)
    expect(db.getBookDetail('695233')?.highlightCount).toBe(1)
    db.close()
  })

  it('书架请求失败时不改已有的书，只记下原因', async () => {
    const db = tempDb()
    await runSync(db, library(), { force: false })
    const before = db.getBook('695233')
    const record = await runSync(
      db,
      fakeWeread({
        '/shelf/sync': () => {
          throw new Error('书架不可用')
        },
      }),
      { force: false },
    )
    expect(record.message).toBe('书架不可用')
    expect(record.shelfCount).toBe(0)
    expect(db.getBook('695233')).toMatchObject({
      title: before?.title,
      onShelf: true,
      progress: before?.progress,
    })
    db.close()
  })

  it('不在本次书架里的书只改为不在架，不再请求划线和进度', async () => {
    const db = tempDb()
    const time = localTimestamp(2026)
    await runSync(
      db,
      library({
        books: [
          shelfBook({ bookId: 'keep', title: '留下', readUpdateTime: time }),
          shelfBook({ bookId: 'gone', title: '拿走', readUpdateTime: time }),
        ],
        notes: [
          { bookId: 'keep', noteCount: 1, sort: 1 },
          { bookId: 'gone', noteCount: 1, sort: 2 },
        ],
        onHighlight: (bookId) => highlights(bookId, [{ bookmarkId: bookId, chapterUid: 108, markText: bookId, range: '3-4' }], [chapter]),
      }),
      { force: false },
    )
    const second = library({
      books: [shelfBook({ bookId: 'keep', title: '留下', readUpdateTime: time })],
      notes: [{ bookId: 'keep', noteCount: 1, sort: 1 }],
    })
    await runSync(db, second, { force: false })
    expect(second.calls.map((call) => call.apiName)).toEqual(['/shelf/sync', '/user/notebooks'])
    expect(db.getBook('gone')?.onShelf).toBe(false)
    expect(db.getBookDetail('gone')?.highlightCount).toBe(1)
    expect(db.listOnShelf().map((book) => book.bookId)).toEqual(['keep'])
    db.close()
  })

  it('没有阅读时间的书，进度成功一次后不再请求，直到出现时间', async () => {
    const db = tempDb()
    await runSync(
      db,
      library({ books: [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: null })] }),
      { force: false },
    )
    const second = library({ books: [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: null })] })
    await runSync(db, second, { force: false })
    expect(second.calls.map((call) => call.apiName)).not.toContain('/book/getprogress')
    const dated = library({
      books: [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: localTimestamp(2025) })],
      onProgress: () => progress(7, 70),
    })
    await runSync(db, dated, { force: false })
    expect(dated.calls.map((call) => call.apiName)).toContain('/book/getprogress')
    expect(db.getBook('695233')?.progress).toBe(7)
    db.close()
  })

  it('笔记本分页会带上 lastSort', async () => {
    const db = tempDb()
    const client = fakeWeread({
      '/shelf/sync': () => ({ books: [shelfBook({ bookId: 'p2', title: '第二页' })] }),
      '/user/notebooks': (params) => {
        if (params.lastSort == null) {
          return notebookPage([{ bookId: 'p1', noteCount: 1, sort: 11 }], 1)
        }
        return notebookPage([{ bookId: 'p2', noteCount: 4, sort: 22 }], 0)
      },
      '/book/getprogress': () => progress(1, 1),
      '/book/bookmarklist': () => highlights('p2', [{ bookmarkId: 'x', chapterUid: 1, markText: '页', range: '1-2' }], [{ chapterUid: 1, chapterIdx: 1, title: '一' }]),
    })
    await runSync(db, client, { force: false })
    expect(client.calls.filter((call) => call.apiName === '/user/notebooks').map((call) => call.params.lastSort)).toEqual([undefined, 11])
    expect(db.getBook('p2')?.savedNoteCount).toBe(4)
    db.close()
  })

  it('进度响应没有 progress 时记为 0，不算失败', async () => {
    const db = tempDb()
    const record = await runSync(
      db,
      library({
        onProgress: () => ({ book: { recordReadingTime: 0 } }),
      }),
      { force: false },
    )
    expect(record.failed).toBe(0)
    expect(db.getBook('695233')?.progress).toBe(0)
    expect(db.getBook('695233')?.readingTimeSeconds).toBe(0)
    db.close()
  })

  it('进度请求失败会再试，第三次成功则不算失败', async () => {
    const db = tempDb()
    let attempts = 0
    const record = await runSync(
      db,
      library({
        onProgress: () => {
          attempts += 1
          if (attempts < 3) throw new Error('timeout')
          return progress(4, 40)
        },
      }),
      { force: false },
    )
    expect(attempts).toBe(3)
    expect(record.failed).toBe(0)
    expect(db.getBook('695233')?.progress).toBe(4)
    db.close()
  })
})
