import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/server/app'
import { openDatabase, type AppDatabase } from '../src/server/db'
import type { HandbookModel } from '../src/server/handbook-run'
import { fakeWeread, tempDb } from './helpers'

function seed(db: AppDatabase, bookId: string, title: string, markText: string) {
  db.upsertShelfBook({
    bookId,
    title,
    author: '作者',
    cover: '',
    readUpdateTime: 1_700_000_000,
    category: null,
    finishReading: true,
  })
  db.replaceHighlights(bookId, 1, [{ chapterUid: 1, chapterIdx: 1, title: '第一章' }], [
    { bookmarkId: `${bookId}-1`, chapterUid: 1, markText, range: null },
  ])
}

function seven(bookIds: string[]) {
  return {
    chapters: Array.from({ length: 7 }, (_, index) => ({
      title: `第${index + 1}章`,
      body: `第${index + 1}章写这位读者。`,
      bookIds,
    })),
  }
}

function modelFrom(complete: HandbookModel['complete'], draw?: HandbookModel['draw']): HandbookModel & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    async complete(prompt) {
      prompts.push(prompt)
      return complete(prompt)
    },
    async draw(prompt, file) {
      prompts.push(prompt)
      if (draw) return draw(prompt, file)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    },
  }
}

async function settle(app: ReturnType<typeof createApp>) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await app.request('/api/handbook')
    const body = await response.json() as {
      job: { running: boolean; error: string | null; message: string }
      handbookId: string | null
      history: Array<{ id: string }>
      chapters: Array<{ title: string; body: string; hasImage: boolean; books: Array<{ quotes: string[] }> }>
    }
    if (!body.job.running) return body
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('手册作业没有结束')
}

describe('人生手册接口', () => {
  it('按书切开，七章正文不包含原始划线', async () => {
    const db = tempDb()
    seed(db, 'a', '甲书', '甲书独有句子阿尔法')
    seed(db, 'b', '乙书', '乙书独有句子贝塔')
    seed(db, 'c', '丙书', '丙书独有句子伽马')
    const model = modelFrom(async (prompt) => {
      if (prompt.includes('一张不超过 180 字')) return '这张卡片只谈当前这本书。'
      return JSON.stringify(seven(['a', 'b', 'missing']))
    })
    const app = createApp({ db, createClient: () => fakeWeread({}), handbookModel: model })
    const tooMany = await app.request('/api/handbook/write', {
      method: 'POST',
      body: JSON.stringify({ bookIds: ['a', 'b', 'c', 'd'] }),
    })
    expect(tooMany.status).toBe(400)
    expect((await tooMany.json()).error).toBe('每次最多选择 3 本书')
    expect(model.prompts).toHaveLength(0)
    const found = await app.request('/api/handbook/books?q=丙')
    const listed = await found.json() as { books: Array<{ bookId: string }> }
    expect(listed.books.map((book) => book.bookId)).toEqual(['c'])
    expect(JSON.stringify(listed)).not.toContain('丙书独有句子伽马')
    const started = await app.request('/api/handbook/write', {
      method: 'POST',
      body: JSON.stringify({ bookIds: ['a', 'b'] }),
    })
    expect(started.status).toBe(200)
    const view = await settle(app)
    expect(view.job.error).toBeNull()
    expect(view.chapters).toHaveLength(7)
    const cardPrompts = model.prompts.filter((prompt) => prompt.includes('一张不超过 180 字'))
    expect(cardPrompts).toHaveLength(2)
    expect(cardPrompts.some((prompt) => prompt.includes('甲书独有句子阿尔法') && prompt.includes('乙书独有句子贝塔'))).toBe(false)
    const chapterPrompt = model.prompts.find((prompt) => prompt.includes('必须正好 7 章')) ?? ''
    expect(chapterPrompt).not.toContain('甲书独有句子阿尔法')
    expect(chapterPrompt).not.toContain('乙书独有句子贝塔')
    expect(model.prompts.join('\n')).not.toContain('丙书独有句子伽马')
    expect(view.chapters[0]?.books[0]?.quotes[0]).toContain('甲书独有句子阿尔法'.slice(0, 20))
    db.close()
  })

  it('改一章会留下，重画只送这一章的文字', async () => {
    const db = tempDb()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handbook-image-'))
    seed(db, 'a', '甲书', '甲书独有句子阿尔法')
    const model = modelFrom(async (prompt) => {
      if (prompt.includes('一张不超过 180 字')) return '卡片'
      if (prompt.includes('重写人生手册')) return JSON.stringify({ title: '改过的章', body: '重写后的正文。', bookIds: ['a'] })
      return JSON.stringify(seven(['a']))
    })
    const app = createApp({
      db,
      createClient: () => fakeWeread({}),
      handbookModel: model,
      handbookImageDir: dir,
    })
    await app.request('/api/handbook/write', {
      method: 'POST',
      body: JSON.stringify({ bookIds: ['a'] }),
    })
    await settle(app)
    const saved = await app.request('/api/handbook/chapters/2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '手改的章名', body: '手改的正文。' }),
    })
    expect(saved.status).toBe(200)
    expect((await saved.json()).chapters[1].title).toBe('手改的章名')

    await app.request('/api/handbook/chapters/2/rewrite', { method: 'POST' })
    const rewritten = await settle(app)
    expect(rewritten.chapters[1]?.title).toBe('改过的章')
    expect(rewritten.chapters[0]?.title).toBe('第1章')

    const before = model.prompts.length
    await app.request('/api/handbook/chapters/2/draw', { method: 'POST' })
    const drawn = await settle(app)
    expect(drawn.chapters[1]?.hasImage).toBe(true)
    const drawPrompt = model.prompts.slice(before).join('\n')
    expect(drawPrompt).toContain('改过的章')
    expect(drawPrompt).not.toContain('甲书独有句子阿尔法')
    const image = await app.request('/api/handbook/chapters/2/image')
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toContain('image/png')
    expect(new Uint8Array(await image.arrayBuffer())[0]).toBe(0x89)
    db.close()
  })

  it('空书架和正在写的时候会停住', async () => {
    const db = tempDb()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const model = modelFrom(async (prompt) => {
      if (prompt.includes('甲书')) await gate
      return '卡片'
    })
    const empty = createApp({ db, createClient: () => fakeWeread({}), handbookModel: model })
    const missing = await empty.request('/api/handbook/write', {
      method: 'POST',
      body: JSON.stringify({ bookIds: ['a'] }),
    })
    expect(missing.status).toBe(400)
    expect((await missing.json()).error).toBe('架上没有这几本书')

    seed(db, 'a', '甲书', '甲书独有句子阿尔法')
    const busy = await empty.request('/api/handbook/write', {
      method: 'POST',
      body: JSON.stringify({ bookIds: ['a'] }),
    })
    expect(busy.status).toBe(200)
    const again = await empty.request('/api/handbook/write', {
      method: 'POST',
      body: JSON.stringify({ bookIds: ['a'] }),
    })
    expect(again.status).toBe(409)
    release()
    await settle(empty)
    db.close()
  })

  it('没有 Cursor CLI 时生成失败，已有章节仍可阅读', async () => {
    const previous = process.env.CURSOR_AGENT_BIN
    process.env.CURSOR_AGENT_BIN = 'off'
    const db = tempDb()
    try {
      seed(db, 'a', '甲书', '甲书独有句子阿尔法')
      db.createHandbook([{ title: '已有', body: '已经写好的一章正文。', bookIds: ['a'] }, ...Array.from({ length: 6 }, (_, index) => ({
        title: `第${index + 2}章`,
        body: '正文',
        bookIds: ['a'],
      }))])
      const app = createApp({ db, createClient: () => fakeWeread({}) })
      const current = await app.request('/api/handbook')
      const stored = await current.json() as { modelReady: boolean; chapters: Array<{ title: string }> }
      expect(stored.modelReady).toBe(false)
      expect(stored.chapters[0]?.title).toBe('已有')
      await app.request('/api/handbook/write', {
        method: 'POST',
        body: JSON.stringify({ rebuildCards: true, bookIds: ['a'] }),
      })
      expect((await settle(app)).job.error).toBe('生成需要本机已登录的 Cursor CLI（agent）')
    } finally {
      if (previous === undefined) delete process.env.CURSOR_AGENT_BIN
      else process.env.CURSOR_AGENT_BIN = previous
      db.close()
    }
  })

  it('旧的一本手册会留在历史里', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handbook-old-'))
    const file = path.join(dir, 'old.sqlite')
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE handbook_chapters (
        user_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        has_image INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, position)
      );
      CREATE TABLE handbook_chapter_books (
        user_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        book_id TEXT NOT NULL,
        PRIMARY KEY (user_id, position, book_id)
      );
      INSERT INTO handbook_chapters (user_id, position, title, body, has_image, updated_at)
      VALUES ('local', 1, '寻觅之后', '正文', 0, '2026-10-10 06:47:33');
      INSERT INTO handbook_chapter_books (user_id, position, book_id) VALUES ('local', 1, 'a');
    `)
    raw.close()
    const db = openDatabase(file)
    const history = db.listHandbooks()
    expect(history).toHaveLength(1)
    expect(db.listHandbookChapters(history[0]?.id ?? '')[0]?.title).toBe('寻觅之后')
    db.close()
  })

  it('再写一本时上一本还在', async () => {
    const db = tempDb()
    seed(db, 'a', '甲书', '甲书独有句子阿尔法')
    let round = 0
    const model = modelFrom(async (prompt) => {
      if (prompt.includes('一张不超过 180 字')) return '卡片'
      round += 1
      return JSON.stringify({
        chapters: Array.from({ length: 7 }, (_, index) => ({
          title: round === 1 ? `旧${index + 1}` : `新${index + 1}`,
          body: '正文',
          bookIds: ['a'],
        })),
      })
    })
    const app = createApp({ db, createClient: () => fakeWeread({}), handbookModel: model })
    await app.request('/api/handbook/write', { method: 'POST', body: JSON.stringify({ bookIds: ['a'] }) })
    const first = await settle(app)
    await app.request('/api/handbook/write', { method: 'POST', body: JSON.stringify({ bookIds: ['a'] }) })
    const second = await settle(app)
    expect(second.history).toHaveLength(2)
    expect(second.chapters[0]?.title).toBe('新1')
    expect(second.handbookId).not.toBe(first.handbookId)
    const older = await app.request(`/api/handbook?id=${first.handbookId}`)
    const kept = await older.json() as { chapters: Array<{ title: string }> }
    expect(kept.chapters[0]?.title).toBe('旧1')
    db.close()
  })

  it('新建一本空白手册，旧的还在', async () => {
    const db = tempDb()
    db.createHandbook(Array.from({ length: 7 }, () => ({ title: '旧章', body: '旧正文', bookIds: [] })))
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    const before = await app.request('/api/handbook')
    const olderId = (await before.json() as { handbookId: string }).handbookId
    const response = await app.request('/api/handbook', { method: 'POST' })
    expect(response.status).toBe(200)
    const created = await response.json() as {
      handbookId: string
      history: Array<{ id: string; title: string }>
      chapters: Array<{ title: string; body: string; books: unknown[] }>
    }
    expect(created.handbookId).not.toBe(olderId)
    expect(created.history).toHaveLength(2)
    expect(created.chapters).toHaveLength(7)
    expect(created.chapters.every((chapter) => chapter.title === '' && chapter.body === '' && chapter.books.length === 0)).toBe(true)
    const older = await app.request(`/api/handbook?id=${olderId}`)
    const kept = await older.json() as { chapters: Array<{ title: string }> }
    expect(kept.chapters[0]?.title).toBe('旧章')
    const named = await app.request('/api/handbook/chapters/1', {
      method: 'PATCH',
      body: JSON.stringify({ handbookId: created.handbookId, title: '手写的第一章', body: '' }),
    })
    expect(named.status).toBe(200)
    const namedBody = await named.json() as { chapters: Array<{ title: string; body: string }> }
    expect(namedBody.chapters[0]?.title).toBe('手写的第一章')
    expect(namedBody.chapters[0]?.body).toBe('')
    db.close()
  })

  it('删掉一本后其余手册还在，图也一起去掉', async () => {
    const db = tempDb()
    const imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handbook-images-'))
    const keepId = db.createHandbook([{ title: '留下', body: '正文', bookIds: [] }])
    const dropId = db.createHandbook([{ title: '删掉', body: '正文', bookIds: [] }])
    const image = path.join(imageDir, 'local', dropId, '1.png')
    fs.mkdirSync(path.dirname(image), { recursive: true })
    fs.writeFileSync(image, 'png')
    const app = createApp({ db, createClient: () => fakeWeread({}), handbookImageDir: imageDir })
    const gone = await app.request(`/api/handbook/${dropId}?open=${keepId}`, { method: 'DELETE' })
    expect(gone.status).toBe(200)
    const body = await gone.json() as { handbookId: string; history: Array<{ id: string }>; chapters: Array<{ title: string }> }
    expect(body.handbookId).toBe(keepId)
    expect(body.history.map((item) => item.id)).toEqual([keepId])
    expect(body.chapters[0]?.title).toBe('留下')
    expect(fs.existsSync(image)).toBe(false)
    expect((await app.request(`/api/handbook/${dropId}`, { method: 'DELETE' })).status).toBe(404)
    db.close()
  })
})
