import { describe, expect, it } from 'vitest'
import { createApp } from '../src/server/app'
import { groupBooks } from '../src/server/shelf'
import { createWereadClient, SKILL_VERSION } from '../src/server/weread'
import { fakeWeread, highlights, localTimestamp, progress, shelfBook, tempDb } from './helpers'
import { runSync } from '../src/server/sync'

describe('网页接口', () => {
  it('开启登录后，未登录不能看书架，注册后可以', async () => {
    const db = tempDb()
    const app = createApp({ db, createClient: () => fakeWeread({}), authRequired: true })
    const denied = await app.request('/api/books')
    expect(denied.status).toBe(401)
    const registered = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reader', email: 'a@b.co', password: 'password1' }),
    })
    expect(registered.status).toBe(200)
    const cookie = registered.headers.get('set-cookie') ?? ''
    const books = await app.request('/api/books', { headers: { cookie: cookie.split(';')[0] ?? '' } })
    expect(books.status).toBe(200)
    const chinese = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '读者甲', email: 'c@b.co', password: 'password1' }),
    })
    expect(chinese.status).toBe(200)
    db.close()
  })

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
    expect(await response.json()).toEqual({ error: '尚未绑定微信读书' })
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
    expect(await first.json()).toMatchObject({ running: true, phase: 'shelf', total: 0 })
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

describe('开屏一句', () => {
  it('只返回久未打开的书里还能独立读的划线', async () => {
    const db = tempDb()
    const ancient = Math.floor(Date.now() / 1000) - 400 * 86400
    const recent = Math.floor(Date.now() / 1000) - 2 * 86400
    db.upsertShelfBook(shelfBook({ bookId: 'old', title: '旧书', readUpdateTime: ancient }))
    db.upsertShelfBook(shelfBook({ bookId: 'new', title: '新书', readUpdateTime: recent }))
    db.replaceHighlights('old', 2, [{ chapterUid: 4, chapterIdx: 1, title: '夜' }], [
      { bookmarkId: 'frag', chapterUid: 4, markText: '但是这句接上文。', range: null },
      { bookmarkId: 'line', chapterUid: 4, markText: '他把窗打开，夜里的风就这样进来了。', range: '10-20' },
    ])
    db.replaceHighlights('new', 1, [{ chapterUid: 1, chapterIdx: 1, title: '灯' }], [
      { bookmarkId: 'fresh', chapterUid: 1, markText: '他把灯关掉，房间就这样安静下来。', range: null },
    ])
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    const body = await (await app.request('/api/encounter')).json()
    expect(body).toEqual({
      encounters: [{
        bookmarkId: 'line',
        bookId: 'old',
        title: '旧书',
        chapterUid: 4,
        markText: '他把窗打开，夜里的风就这样进来了。',
      }],
    })
    db.close()
  })

  it('count 决定每次抽出几条，超出范围时夹紧', async () => {
    const db = tempDb()
    const ancient = Math.floor(Date.now() / 1000) - 400 * 86400
    db.upsertShelfBook(shelfBook({ bookId: 'old', title: '旧书', readUpdateTime: ancient }))
    db.replaceHighlights('old', 2, [{ chapterUid: 4, chapterIdx: 1, title: '夜' }], [
      { bookmarkId: 'one', chapterUid: 4, markText: '他把窗打开，夜里的风就这样进来了。', range: '10-20' },
      { bookmarkId: 'two', chapterUid: 4, markText: '他把灯关掉，房间就这样安静下来。', range: '30-40' },
    ])
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    expect((await (await app.request('/api/encounter?count=1')).json()).encounters).toHaveLength(1)
    expect((await (await app.request('/api/encounter?count=99')).json()).encounters).toHaveLength(2)
    expect((await (await app.request('/api/encounter?count=0')).json()).encounters).toHaveLength(1)
    db.close()
  })

  it('可以只看已读完或进行中的书', async () => {
    const db = tempDb()
    const ancient = Math.floor(Date.now() / 1000) - 400 * 86400
    const line = '他把窗打开，夜里的风就这样进来了。'
    db.upsertShelfBook(shelfBook({ bookId: 'done', title: '读完', readUpdateTime: ancient, finishReading: true }))
    db.upsertShelfBook(shelfBook({ bookId: 'open', title: '在读', readUpdateTime: ancient }))
    db.upsertShelfBook(shelfBook({ bookId: 'new', title: '未读', readUpdateTime: ancient }))
    db.setProgress('open', 40, 120, { kind: 'time', time: ancient })
    db.replaceHighlights('done', 1, [{ chapterUid: 1, chapterIdx: 1, title: '章' }], [
      { bookmarkId: 'done-line', chapterUid: 1, markText: line, range: null },
    ])
    db.replaceHighlights('open', 1, [{ chapterUid: 1, chapterIdx: 1, title: '章' }], [
      { bookmarkId: 'open-line', chapterUid: 1, markText: line, range: null },
    ])
    db.replaceHighlights('new', 1, [{ chapterUid: 1, chapterIdx: 1, title: '章' }], [
      { bookmarkId: 'new-line', chapterUid: 1, markText: line, range: null },
    ])
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    const ids = async (scope: string) => {
      const body = await (await app.request(`/api/encounter?count=10&scope=${scope}`)).json() as { encounters: Array<{ bookmarkId: string }> }
      return body.encounters.map((item) => item.bookmarkId).sort()
    }
    expect(await ids('finished')).toEqual(['done-line'])
    expect(await ids('reading')).toEqual(['open-line'])
    expect(await ids('all')).toEqual(['done-line', 'new-line', 'open-line'])
    expect(await ids('nope')).toEqual(['done-line', 'new-line', 'open-line'])
    const again = await app.request('/api/encounter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, scope: 'all', view: 'flat', exclude: ['done-line'] }),
    })
    const againIds = (await again.json() as { encounters: Array<{ bookmarkId: string }> }).encounters.map((item) => item.bookmarkId)
    expect(againIds).toHaveLength(1)
    expect(againIds[0]).not.toBe('done-line')
    db.close()
  })

  it('可以按分类和分组聚合成段', async () => {
    const db = tempDb()
    const ancient = Math.floor(Date.now() / 1000) - 400 * 86400
    const line = '他把窗打开，夜里的风就这样进来了。'
    const second = '她把信收回抽屉，没有再提起这件事。'
    db.upsertShelfBook(shelfBook({ bookId: 'lit', title: '文', readUpdateTime: ancient, category: '文学-小说' }))
    db.upsertShelfBook(shelfBook({ bookId: 'his', title: '史', readUpdateTime: ancient, category: '历史' }))
    db.replaceHighlights('lit', 3, [{ chapterUid: 1, chapterIdx: 1, title: '章' }], [
      { bookmarkId: 'lit-a', chapterUid: 1, markText: line, range: null },
      { bookmarkId: 'lit-b', chapterUid: 1, markText: second, range: null },
      { bookmarkId: 'lit-short', chapterUid: 1, markText: '但是这句接上文。', range: null },
    ])
    db.replaceHighlights('his', 1, [{ chapterUid: 1, chapterIdx: 1, title: '章' }], [
      { bookmarkId: 'his-a', chapterUid: 1, markText: line, range: null },
    ])
    db.replaceArchiveGroups([{ name: '枕边', bookIds: ['lit'] }])
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    const categories = await (await app.request('/api/encounter?view=category&count=1')).json() as { sections: Array<{ key: string; lineCount: number; encounters: Array<{ bookmarkId: string }> }> }
    expect(categories.sections.map((section) => [section.key, section.lineCount, section.encounters.length])).toEqual([
      ['文学', 3, 1],
      ['历史', 1, 1],
    ])
    const groups = await (await app.request('/api/encounter?view=group&count=5')).json() as { sections: Array<{ key: string; encounters: Array<{ bookmarkId: string }> }> }
    expect(groups.sections.map((section) => [section.key, section.encounters.map((item) => item.bookmarkId).sort()])).toEqual([
      ['枕边', ['lit-a', 'lit-b']],
      ['未分组', ['his-a']],
    ])
    const flat = await (await app.request('/api/encounter?count=10')).json() as { encounters: unknown[]; sections?: unknown }
    expect(flat.encounters).toHaveLength(3)
    expect(flat.sections).toBeUndefined()
    db.close()
  })

  it('没有合格划线时不占开屏', async () => {
    const db = tempDb()
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    expect(await (await app.request('/api/encounter')).json()).toEqual({ encounters: [] })
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

describe('分享书架', () => {
  it('同一条链接可以看划线和地图，关掉后不能看', async () => {
    const db = tempDb()
    const mark = '把复杂的事情拆成可以行走的一步。'
    db.upsertShelfBook({
      bookId: '1',
      title: '思考的技术',
      author: '甲',
      cover: '',
      readUpdateTime: localTimestamp(2024),
      category: '个人成长-认知思维',
    }, 'owner')
    db.replaceHighlights('1', 1, [{ chapterUid: 1, chapterIdx: 1, title: '章' }], [
      { bookmarkId: 'h1', chapterUid: 1, markText: mark, range: null },
    ], 'owner')
    db.upsertShelfBook({
      bookId: 'secret',
      title: '不该出现',
      author: '',
      cover: '',
      readUpdateTime: localTimestamp(2024),
      category: '文学-散文',
    }, 'other')
    db.setShare('owner', { enabled: true, token: 'tok' })
    const app = createApp({ db, createClient: () => fakeWeread({}), authRequired: true })

    const locked = await app.request('/api/map')
    expect(locked.status).toBe(401)

    const map = await app.request('/api/public/shelves/tok/map')
    expect(map.status).toBe(200)
    const books = (await map.json() as { books: Array<{ bookId: string }> }).books
    expect(books.map((book) => book.bookId)).toEqual(['1'])

    const quotes = await app.request(`/api/public/shelves/tok/map/quotes?category=${encodeURIComponent('个人成长-认知思维')}`)
    expect(quotes.status).toBe(200)
    expect((await quotes.json() as { quotes: Array<{ markText: string }> }).quotes[0]?.markText).toBe(mark)

    const lines = await app.request('/api/public/shelves/tok/encounter?count=1')
    expect(lines.status).toBe(200)
    expect((await lines.json() as { encounters: Array<{ bookmarkId: string }> }).encounters[0]?.bookmarkId).toBe('h1')

    db.disableShare('owner')
    expect((await app.request('/api/public/shelves/tok/map')).status).toBe(404)
    expect((await app.request('/api/public/shelves/tok/encounter')).status).toBe(404)
    db.close()
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
