import { describe, expect, it } from 'vitest'
import { createApp } from '../src/server/app'
import type { AppDatabase } from '../src/server/db'
import { fakeWeread, tempDb } from './helpers'

const now = new Date(2026, 9, 8, 12)

function seed(db: AppDatabase, book: {
  bookId: string
  title: string
  category?: string | null
  readUpdateTime?: number | null
}, lines: string[]) {
  db.upsertShelfBook({
    bookId: book.bookId,
    title: book.title,
    author: '作者',
    cover: '',
    readUpdateTime: book.readUpdateTime === undefined ? Math.floor(now.getTime() / 1000) : book.readUpdateTime,
    category: book.category ?? null,
  })
  db.replaceHighlights(
    book.bookId,
    lines.length,
    [{ chapterUid: 1, chapterIdx: 1, title: '第一章' }],
    lines.map((markText, index) => ({ bookmarkId: `${book.bookId}-${index}`, chapterUid: 1, markText, range: null })),
  )
}

function appFor(db: AppDatabase) {
  return createApp({ db, createClient: () => fakeWeread({}), now: () => now })
}

describe('主题', () => {
  it('先圈分类再归纳，改名留着，重新归纳才换掉', async () => {
    const db = tempDb()
    seed(db, { bookId: 'm', title: '市场', category: '经济-金融' }, [
      '市场里的价格会把分散的知识集中起来。',
    ])
    seed(db, { bookId: 'p', title: '价格', category: '经济-商业' }, [
      '价格把分散在各处的知识集中到市场里。',
    ])
    seed(db, { bookId: 'w', title: '风', category: '文学-散文' }, [
      '夜里的风从海上吹进窗子里来。',
    ])
    const app = appFor(db)

    const scopes = await app.request('/api/themes/scopes')
    expect(scopes.status).toBe(200)
    const scopeBody = await scopes.json() as { categories: Array<{ key: string; highlightCount: number }> }
    expect(scopeBody.categories.map((item) => item.key)).toEqual(['经济', '文学'])
    expect(scopeBody.categories.find((item) => item.key === '经济')?.highlightCount).toBe(2)

    const empty = await app.request('/api/themes?kind=category&key=' + encodeURIComponent('经济'))
    expect(await empty.json()).toMatchObject({ clustered: false, themes: [], bookCount: 2, highlightCount: 2 })

    const clustered = await app.request('/api/themes/cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category', key: '经济' }),
    })
    expect(clustered.status).toBe(200)
    const board = await clustered.json() as { themes: Array<{ id: string; name: string; count: number }>; unassignedCount: number }
    expect(board.themes).toHaveLength(1)
    expect(board.themes[0]?.count).toBe(2)
    expect(board.unassignedCount).toBe(0)
    const lines = await app.request(`/api/themes/highlights?kind=category&key=${encodeURIComponent('经济')}&theme=${board.themes[0]?.id}`)
    expect((await lines.json() as { highlights: Array<{ title: string }> }).highlights.map((item) => item.title).sort()).toEqual(['价格', '市场'])

    const renamed = await app.request('/api/themes/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId: board.themes[0]?.id, name: '价格与知识' }),
    })
    expect(renamed.status).toBe(200)
    const kept = await app.request('/api/themes?kind=category&key=' + encodeURIComponent('经济'))
    expect(await kept.json()).toMatchObject({ clustered: true, themes: [{ name: '价格与知识', count: 2 }] })

    const again = await app.request('/api/themes/cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category', key: '经济' }),
    })
    const reset = await again.json() as { themes: Array<{ name: string }> }
    expect(reset.themes.map((theme) => theme.name)).not.toContain('价格与知识')
    db.close()
  })

  it('新划线留在尚未归入，挪进新主题，挪空后主题消失', async () => {
    const db = tempDb()
    seed(db, { bookId: 'm', title: '市场', category: '经济' }, [
      '市场里的价格会把分散的知识集中起来。',
      '价格把分散在各处的知识集中到市场里。',
    ])
    const app = appFor(db)
    const first = await (await app.request('/api/themes/cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category', key: '经济' }),
    })).json() as { themes: Array<{ id: string }> }
    db.replaceHighlights('m', 3, [{ chapterUid: 1, chapterIdx: 1, title: '第一章' }], [
      { bookmarkId: 'm-0', chapterUid: 1, markText: '市场里的价格会把分散的知识集中起来。', range: null },
      { bookmarkId: 'm-1', chapterUid: 1, markText: '价格把分散在各处的知识集中到市场里。', range: null },
      { bookmarkId: 'm-2', chapterUid: 1, markText: '交易把分散的意愿收成一个价格。', range: null },
    ])
    const board = await (await app.request('/api/themes?kind=category&key=' + encodeURIComponent('经济'))).json() as { unassignedCount: number }
    expect(board.unassignedCount).toBe(1)

    const created = await app.request('/api/themes/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category', key: '经济', bookmarkId: 'm-2', create: true }),
    })
    expect(created.status).toBe(200)
    const withNew = await created.json() as { themes: Array<{ id: string; name: string; count: number }>; unassignedCount: number }
    expect(withNew.unassignedCount).toBe(0)
    const fresh = withNew.themes.find((theme) => theme.id !== first.themes[0]?.id)
    expect(fresh?.count).toBe(1)

    const emptied = await app.request('/api/themes/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category', key: '经济', bookmarkId: 'm-2', themeId: null }),
    })
    const after = await emptied.json() as { themes: Array<{ id: string }> }
    expect(after.themes.map((theme) => theme.id)).toEqual([first.themes[0]?.id])
    db.close()
  })

  it('最近读过按九十天计算，离开窗口的划线不再出现', async () => {
    const db = tempDb()
    const inside = Math.floor(now.getTime() / 1000) - 10 * 24 * 60 * 60
    const outside = Math.floor(now.getTime() / 1000) - 100 * 24 * 60 * 60
    seed(db, { bookId: 'new', title: '新书', category: '历史', readUpdateTime: inside }, [
      '市场里的价格会把分散的知识集中起来。',
      '价格把分散在各处的知识集中到市场里。',
    ])
    seed(db, { bookId: 'old', title: '旧书', category: '历史', readUpdateTime: outside }, [
      '夜里的风从海上吹进窗子里来。',
      '海上的风夜里吹进了窗子里面。',
    ])
    const app = appFor(db)
    const board = await (await app.request('/api/themes/cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'recent', key: 'recent' }),
    })).json() as { bookCount: number; themes: Array<{ count: number }> }
    expect(board.bookCount).toBe(1)
    expect(board.themes).toHaveLength(1)
    expect(board.themes[0]?.count).toBe(2)
    db.close()
  })

  it('合并后划线归到留下名字的那一堆', async () => {
    const db = tempDb()
    seed(db, { bookId: 'm', title: '市场', category: '经济' }, [
      '市场里的价格会把分散的知识集中起来。',
      '价格把分散在各处的知识集中到市场里。',
    ])
    const app = appFor(db)
    const board = await (await app.request('/api/themes/cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category', key: '经济' }),
    })).json() as { themes: Array<{ id: string }> }
    const created = await (await app.request('/api/themes/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category', key: '经济', bookmarkId: 'm-0', create: true }),
    })).json() as { themes: Array<{ id: string; count: number }> }
    const source = created.themes.find((theme) => theme.id !== board.themes[0]?.id)
    const merged = await app.request('/api/themes/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: source?.id, targetId: board.themes[0]?.id }),
    })
    expect(merged.status).toBe(200)
    const after = await (await app.request('/api/themes?kind=category&key=' + encodeURIComponent('经济'))).json() as { themes: Array<{ id: string; count: number }> }
    expect(after.themes).toEqual([{ id: board.themes[0]?.id, name: expect.anything(), count: 2 }])
    db.close()
  })

  it('空名字和范围外的句子会被拒绝', async () => {
    const db = tempDb()
    seed(db, { bookId: 'm', title: '市场', category: '经济' }, [
      '市场里的价格会把分散的知识集中起来。',
      '价格把分散在各处的知识集中到市场里。',
    ])
    const app = appFor(db)
    const board = await (await app.request('/api/themes/cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category', key: '经济' }),
    })).json() as { themes: Array<{ id: string }> }
    const blank = await app.request('/api/themes/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId: board.themes[0]?.id, name: '   ' }),
    })
    expect(blank.status).toBe(400)
    const outside = await app.request('/api/themes/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category', key: '文学', bookmarkId: 'm-0', themeId: board.themes[0]?.id }),
    })
    expect(outside.status).toBe(400)
    db.close()
  })
})
