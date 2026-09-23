import { describe, expect, it } from 'vitest'
import { createApp } from '../src/server/app'
import { groupBooks } from '../src/server/shelf'
import { createWereadClient, SKILL_VERSION } from '../src/server/weread'
import { fakeWeread, highlights, localTimestamp, progress, shelfBook, tempDb } from './helpers'
import { runSync } from '../src/server/sync'

describe('网页接口', () => {
  it('响应里没有 API Key，鉴权失败时旧 Key 还在', async () => {
    const db = tempDb()
    db.setApiKey('old-secret-key')
    const app = createApp({
      db,
      createClient: (apiKey) =>
        fakeWeread({
          '/user/notebooks': () => {
            if (apiKey !== 'valid-key') throw new Error('no')
            return { books: [], hasMore: 0 }
          },
        }),
    })
    const denied = await app.request('/api/key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'new-secret-key' }),
    })
    expect(denied.status).toBe(400)
    expect(db.getApiKey()).toBe('old-secret-key')

    const saved = await app.request('/api/key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'valid-key' }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ configured: true })

    const bodies = [
      await (await app.request('/api/key')).text(),
      await (await app.request('/api/books')).text(),
      await (await app.request('/api/sync')).text(),
    ]
    for (const body of bodies) {
      expect(body).not.toContain('valid-key')
      expect(body).not.toContain('old-secret-key')
    }
    db.close()
  })

  it('没有 Key 时不启动同步，也不写同步记录', async () => {
    const db = tempDb()
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    const response = await app.request('/api/sync', { method: 'POST' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '尚未配置 API Key' })
    expect(db.latestSync()).toBeNull()
    db.close()
  })

  it('同步进行中再次触发不重入', async () => {
    const db = tempDb()
    db.setApiKey('k')
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let shelfCalls = 0
    const app = createApp({
      db,
      createClient: () =>
        fakeWeread({
          '/shelf/sync': async () => {
            shelfCalls += 1
            await gate
            return { books: [] }
          },
          '/user/notebooks': () => ({ books: [], hasMore: 0 }),
        }),
    })
    const first = await app.request('/api/sync', { method: 'POST' })
    const second = await app.request('/api/sync?force=1', { method: 'POST' })
    expect((await first.json()).running).toBe(true)
    expect((await second.json()).running).toBe(true)
    expect(shelfCalls).toBe(1)
    release?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const done = await app.request('/api/sync')
    expect((await done.json()).running).toBe(false)
    db.close()
  })

  it('书页按章节和 range 起点排序，缺席的书仍能按 id 读到', () => {
    const db = tempDb()
    const early = localTimestamp(2024, 3, 2, 9)
    const late = localTimestamp(2026, 1, 4, 18)
    const olderInYear = localTimestamp(2026, 1, 1, 8)
    db.upsertShelfBook(shelfBook({ bookId: 'new', title: '新年晚', readUpdateTime: late }))
    db.upsertShelfBook(shelfBook({ bookId: 'new-early', title: '新年早', readUpdateTime: olderInYear }))
    db.upsertShelfBook(shelfBook({ bookId: 'old', title: '旧年', readUpdateTime: early }))
    db.upsertShelfBook(shelfBook({ bookId: 'unknown', title: '没时间', readUpdateTime: null }))
    db.markAbsentOffShelf(['new', 'new-early', 'old', 'unknown'])
    db.replaceHighlights(
      'new',
      3,
      [
        { chapterUid: 2, chapterIdx: 2, title: '后章' },
        { chapterUid: 1, chapterIdx: 1, title: '前章' },
      ],
      [
        { bookmarkId: 'b', chapterUid: 1, markText: '后句', range: '20-30' },
        { bookmarkId: 'a', chapterUid: 1, markText: '前句', range: '5-8' },
        { bookmarkId: 'c', chapterUid: 1, markText: '坏位置', range: '不是数字' },
        { bookmarkId: 'd', chapterUid: 2, markText: '第二章', range: '1-2' },
      ],
    )
    const detail = db.getBookDetail('new')
    expect(detail?.chapters.map((chapter) => chapter.title)).toEqual(['前章', '后章'])
    expect(detail?.chapters[0]?.highlights.map((item) => item.bookmarkId)).toEqual(['a', 'b', 'c'])
    const grouped = groupBooks(db.listOnShelf())
    expect(grouped.groups.map((group) => group.year)).toEqual(['2026', '2024', '未知'])
    expect(grouped.groups[0]?.books.map((book) => book.bookId)).toEqual(['new', 'new-early'])
    const zeroTime = groupBooks([
      {
        bookId: 'zero',
        title: '没有时间',
        author: '',
        cover: '',
        readUpdateTime: 0,
        progress: null,
        readingTimeSeconds: null,
        highlightCount: 0,
        finishReading: false,
        category: null,
        newRating: null,
        ratingLabel: null,
        wereadUrl: 'https://weread.qq.com/web/reader/zero',
      },
      ...(grouped.groups[0]?.books ?? []),
    ])
    expect(zeroTime.groups.map((group) => group.year)).toEqual(['2026', '未知'])

    db.markAbsentOffShelf(['old'])
    expect(db.listOnShelf().map((book) => book.bookId)).toEqual(['old'])
    expect(db.getBookDetail('new')?.onShelf).toBe(false)
    expect(db.getBookDetail('new')?.highlightCount).toBe(4)
    db.close()
  })

  it('没有入库的书返回 404', async () => {
    const db = tempDb()
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    const response = await app.request('/api/books/missing')
    expect(response.status).toBe(404)
    db.close()
  })
})

describe('微信读书客户端', () => {
  it('把接口名和平铺参数发给 gateway', async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    const client = createWereadClient('secret-key', async (url, init) => {
      seen.url = url
      seen.init = init
      return new Response(JSON.stringify({ book: { progress: 1, readingTime: 2 } }))
    })
    await client.call('/book/getprogress', { bookId: '695233' })
    expect(seen.url).toBe('https://i.weread.qq.com/api/agent/gateway')
    expect(new Headers(seen.init?.headers).get('Authorization')).toBe('Bearer secret-key')
    expect(JSON.parse(String(seen.init?.body))).toEqual({
      api_name: '/book/getprogress',
      bookId: '695233',
      skill_version: SKILL_VERSION,
    })
  })

  it('errcode 非 0 视为失败', async () => {
    const client = createWereadClient('k', async () => new Response(JSON.stringify({ errcode: 401, errmsg: '登录失效' })))
    await expect(client.call('/shelf/sync')).rejects.toThrow('登录失效')
  })
})

describe('同步记录给页面', () => {
  it('结束后的状态能被读到，且不含 Key', async () => {
    const db = tempDb()
    db.setApiKey('secret-key')
    await runSync(db, fakeWeread({
      '/shelf/sync': () => ({ books: [shelfBook({ bookId: '1', title: '一' })] }),
      '/user/notebooks': () => ({ books: [{ bookId: '1', noteCount: 0, sort: 1 }], hasMore: 0 }),
      '/book/getprogress': () => progress(1, 2),
      '/book/bookmarklist': () => ({ updated: [], chapters: [] }),
    }), { force: false })
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    const body = await (await app.request('/api/sync')).text()
    expect(body).not.toContain('secret-key')
    expect(JSON.parse(body).last.shelfCount).toBe(1)
    db.close()
  })
})
