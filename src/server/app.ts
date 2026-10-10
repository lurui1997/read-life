import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { LOCAL_USER_ID, type AppDatabase } from './db'
import { backfillBookMetadata } from './metadata'
import { hashPassword, hashToken, newSessionToken, verifyPassword } from './secrets'
import { createCursorHandbookModel, cursorAgentReady } from './cursor-grok'
import { buildHandbookCards, drawHandbookChapter, rewriteHandbookChapter, writeHandbookChapters, type HandbookModel } from './handbook-run'
import { runSync } from './sync'
import { WereadError, type WereadClient } from './weread'
import { createWereadLogin } from './weread-login'
import { wereadReaderUrl } from './weread-url'
import { pickEncounters } from '../shared/encounter'
import { HANDBOOK_BOOK_LIMIT, handbookBookIds } from '../shared/handbook'
import { RECENT_SCOPE_KEY, type ScopeKind, type ThemeWrite } from '../shared/themes'
import { contentDisposition, exportFilename, highlightsToCsv, highlightsToMarkdown } from '../shared/export-highlights'
import type { SyncStatus } from '../shared/types'

const SESSION_COOKIE = 'rl_session'
const SESSION_DAYS = 14
export const AUTO_SYNC_MS = 60 * 60 * 1000

type SyncState = {
  running: boolean
  done: number
  total: number
  phase: SyncStatus['phase']
  notesSeen: number
  recent: SyncStatus['recent']
}

type HandbookJob = {
  running: boolean
  phase: 'idle' | 'cards' | 'chapters' | 'rewrite' | 'draw'
  done: number
  total: number
  message: string
  error: string | null
}

export type AppOptions = {
  db: AppDatabase
  createClient: (apiKey: string) => WereadClient
  authRequired?: boolean
  cookieSecure?: boolean
  now?: () => Date
  handbookModel?: HandbookModel
  handbookImageDir?: string
}

type AppEnv = { Variables: { userId: string } }

export function createApp(options: AppOptions) {
  const { db, createClient } = options
  const handbookJobs = new Map<string, HandbookJob>()
  const handbookImageDir = options.handbookImageDir ?? path.join(process.cwd(), 'data', 'handbook')

  function handbookJob(userId: string): HandbookJob {
    return handbookJobs.get(userId) ?? { running: false, phase: 'idle', done: 0, total: 0, message: '', error: null }
  }

  function handbookModel(): HandbookModel {
    return options.handbookModel ?? createCursorHandbookModel()
  }

  function handbookImageFile(userId: string, handbookId: string, position: number) {
    const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'local'
    const safeHandbook = handbookId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(handbookImageDir, safeUser, safeHandbook, `${position}.png`)
  }

  function adoptLooseHandbookImages() {
    const earliest = new Map<string, string>()
    for (const row of db.listHandbookOwners()) {
      if (!earliest.has(row.userId)) earliest.set(row.userId, row.handbookId)
    }
    for (const [userId, handbookId] of earliest) {
      const userDir = path.join(handbookImageDir, userId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'local')
      for (let position = 1; position <= 7; position += 1) {
        const loose = path.join(userDir, `${position}.png`)
        if (!fs.existsSync(loose)) continue
        const dest = handbookImageFile(userId, handbookId, position)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        if (!fs.existsSync(dest)) fs.renameSync(loose, dest)
      }
    }
  }
  adoptLooseHandbookImages()

  function chapterPosition(value: string): number | null {
    const position = Number(value)
    if (!Number.isInteger(position) || position < 1 || position > 7) return null
    return position
  }

  function resolveHandbookId(userId: string, requested: string | null): string | null {
    const history = db.listHandbooks(userId)
    if (requested && history.some((item) => item.id === requested)) return requested
    return history[0]?.id ?? null
  }

  function handbookView(userId: string, requested: string | null = null) {
    const history = db.listHandbooks(userId)
    const handbookId = requested && history.some((item) => item.id === requested) ? requested : history[0]?.id ?? null
    const chapters = handbookId ? db.listHandbookChapters(handbookId, userId) : []
    return {
      modelReady: Boolean(options.handbookModel) || cursorAgentReady(),
      job: handbookJob(userId),
      handbookId,
      history,
      chapters: chapters.map((chapter) => ({
        position: chapter.position,
        title: chapter.title,
        body: chapter.body,
        hasImage: chapter.hasImage,
        books: chapter.bookIds.flatMap((bookId) => {
          const book = db.quoteHandbookBook(bookId, userId)
          return book ? [{ bookId, title: book.title, author: book.author, quotes: book.quotes }] : []
        }),
      })),
    }
  }

  function startHandbook(userId: string, work: () => Promise<void>) {
    if (handbookJob(userId).running) return false
    const job: HandbookJob = { running: true, phase: 'cards', done: 0, total: 0, message: '开始', error: null }
    handbookJobs.set(userId, job)
    void work().then(() => {
      job.running = false
      job.phase = 'idle'
    }).catch((error: unknown) => {
      job.running = false
      job.phase = 'idle'
      job.error = error instanceof Error ? error.message : '手册没有写完'
    })
    return true
  }
  const now = () => options.now?.() ?? new Date()
  const authRequired = options.authRequired === true
  const wereadLogin = createWereadLogin()
  const syncStates = new Map<string, SyncState>()
  const registerHits = new Map<string, number[]>()

  function stateFor(userId: string): SyncState {
    const current = syncStates.get(userId) ?? { running: false, done: 0, total: 0, phase: null, notesSeen: 0, recent: [] }
    syncStates.set(userId, current)
    return current
  }

  function nextAutoAt(userId: string, now = Date.now()): string | null {
    if (!db.getApiKey(userId)) return null
    const last = db.latestSync(userId)
    if (!last) return new Date(now).toISOString()
    return new Date(Date.parse(last.finishedAt) + AUTO_SYNC_MS).toISOString()
  }

  function status(userId: string): SyncStatus {
    const state = stateFor(userId)
    const last = db.latestSync(userId)
    return {
      running: state.running,
      done: state.done,
      total: state.total,
      phase: state.phase,
      notesSeen: state.notesSeen,
      recent: state.recent,
      auto: { intervalMs: AUTO_SYNC_MS, nextAt: nextAutoAt(userId) },
      last: last ? { ...last, errors: last.errors.slice(0, 3) } : null,
    }
  }

  function startSync(userId: string, force: boolean): SyncStatus | { error: string } {
    if (!db.getApiKey(userId)) return { error: '尚未绑定微信读书' }
    const state = stateFor(userId)
    if (state.running) return status(userId)
    const apiKey = db.getApiKey(userId)
    if (!apiKey) return { error: '尚未绑定微信读书' }
    state.running = true
    state.done = 0
    state.total = 0
    state.phase = 'shelf'
    state.notesSeen = 0
    state.recent = []
    const client = createClient(apiKey)
    const watch = {
      onProgress(nextDone: number, nextTotal: number, phase: SyncStatus['phase']) {
        state.done = nextDone
        state.total = nextTotal
        state.phase = phase
        if (phase === 'shelf') state.recent = []
      },
      onNotes(seen: number) {
        state.notesSeen = seen
      },
      onBook(event: { bookId: string; title: string; outcome: 'updated' | 'skipped' | 'failed' }) {
        if (event.outcome === 'skipped') return
        state.recent = [
          { bookId: event.bookId, title: event.title, outcome: event.outcome },
          ...state.recent.filter((item) => item.bookId !== event.bookId),
        ].slice(0, 8)
      },
    }
    void (async () => {
      try {
        const first = await runSync(db, client, { force, userId, ...watch })
        if (first.failed > 0) {
          state.done = 0
          state.total = 0
          state.phase = 'shelf'
          state.notesSeen = 0
          await runSync(db, client, { force: false, userId, ...watch })
        }
      } finally {
        state.running = false
        state.done = 0
        state.total = 0
        state.phase = null
        state.notesSeen = 0
      }
      void backfillBookMetadata(db, client, userId)
    })()
    return status(userId)
  }

  const app = new Hono<AppEnv>()
  app.use(compress())

  app.use('*', async (c, next) => {
    if (!authRequired) {
      c.set('userId', LOCAL_USER_ID)
      await next()
      return
    }
    const token = readCookie(c.req.header('cookie'), SESSION_COOKIE)
    const session = token ? db.findSession(hashToken(token)) : null
    const userId = session && session.expiresAt > new Date().toISOString() ? session.userId : ''
    c.set('userId', userId)
    const path = new URL(c.req.url).pathname
    const open = path === '/api/auth/register' || path === '/api/auth/login' || path === '/api/auth/me' || path.startsWith('/api/public/')
    if (path.startsWith('/api/') && !open && !userId) return c.json({ error: '请先登录' }, 401)
    await next()
  })

  app.post('/api/auth/register', async (c) => {
    if (!authRequired) return c.json({ error: '当前是单用户模式' }, 400)
    if (!allowRegister(registerHits, c.req.header('x-forwarded-for') ?? 'local')) {
      return c.json({ error: '注册太频繁，请稍后再试' }, 429)
    }
    const body = await c.req.json().catch(() => null) as { username?: unknown; email?: unknown; password?: unknown } | null
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!/^[\p{Script=Han}a-zA-Z0-9_]{3,32}$/u.test(username)) {
      return c.json({ error: '用户名需为 3–32 位中文、字母、数字或下划线' }, 400)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: '邮箱格式不正确' }, 400)
    if (password.length < 8) return c.json({ error: '密码至少 8 位' }, 400)
    if (db.findUserByLogin(username) || db.findUserByLogin(email)) return c.json({ error: '用户名或邮箱已被使用' }, 400)
    const id = randomUUID()
    db.createUser({ id, username, email, passwordHash: hashPassword(password) })
    writeSession(c, db, id, options.cookieSecure === true)
    return c.json({ id, username, email })
  })

  app.post('/api/auth/login', async (c) => {
    if (!authRequired) return c.json({ error: '当前是单用户模式' }, 400)
    const body = await c.req.json().catch(() => null) as { login?: unknown; password?: unknown } | null
    const login = typeof body?.login === 'string' ? body.login.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const user = db.findUserByLogin(login)
    if (!user || !verifyPassword(password, user.passwordHash)) return c.json({ error: '账号或密码不正确' }, 400)
    writeSession(c, db, user.id, options.cookieSecure === true)
    return c.json({ id: user.id, username: user.username, email: user.email })
  })

  app.post('/api/auth/logout', (c) => {
    const token = readCookie(c.req.header('cookie'), SESSION_COOKIE)
    if (token) db.deleteSession(hashToken(token))
    c.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`)
    return c.json({ ok: true })
  })

  app.get('/api/auth/me', (c) => {
    if (!authRequired) {
      const link = db.getWereadLink(LOCAL_USER_ID)
      return c.json({ authRequired: false, user: null, weread: { linked: link.linked, wrName: link.wrName } })
    }
    const user = db.findUserById(c.get('userId'))
    if (!user) return c.json({ authRequired: true, user: null, weread: { linked: false, wrName: null } })
    const link = db.getWereadLink(user.id)
    return c.json({
      authRequired: true,
      user: { id: user.id, username: user.username, email: user.email },
      weread: { linked: link.linked, wrName: link.wrName },
    })
  })

  app.post('/api/weread/login/start', async (c) => {
    const userId = c.get('userId')
    try {
      return c.json(await wereadLogin.start(userId))
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : '无法生成二维码' }, 502)
    }
  })

  app.get('/api/weread/login/poll', async (c) => {
    const loginId = c.req.query('loginId') ?? ''
    const userId = c.get('userId')
    const result = await wereadLogin.poll(loginId, userId)
    if (result.status === 'done' && result.apiKey) {
      try {
        await createClient(result.apiKey).call('/user/notebooks', { count: 1 })
      } catch {
        return c.json({ status: 'error', error: 'API Key 无效' })
      }
      db.setApiKey(result.apiKey, userId)
      if (result.cookies) db.setWereadCookies(userId, result.cookies, result.wrVid ?? null, result.wrName ?? null)
    }
    return c.json({ status: result.status, error: result.error, wrName: result.wrName ?? null })
  })

  app.delete('/api/weread/login/:loginId', (c) => {
    wereadLogin.cancel(c.req.param('loginId'))
    return c.json({ ok: true })
  })

  app.post('/api/weread/unlink', (c) => {
    db.clearWeread(c.get('userId'))
    return c.json({ linked: false })
  })

  app.get('/api/key', (c) => c.json({ configured: db.getApiKey(c.get('userId')) != null }))

  app.put('/api/key', async (c) => {
    const userId = c.get('userId')
    const body = await c.req.json().catch(() => null) as { apiKey?: unknown } | null
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!apiKey) return c.json({ error: 'API Key 无效' }, 400)
    try {
      await createClient(apiKey).call('/user/notebooks', { count: 1 })
    } catch (error) {
      const message = error instanceof WereadError ? 'API Key 无效' : 'API Key 无效'
      return c.json({ error: message }, 400)
    }
    db.setApiKey(apiKey, userId)
    return c.json({ configured: true })
  })

  app.get('/api/sync', (c) => c.json(status(c.get('userId'))))

  app.post('/api/sync', (c) => {
    const force = c.req.query('force') === '1'
    const result = startSync(c.get('userId'), force)
    if ('error' in result) return c.json(result, 400)
    return c.json(result)
  })

  app.get('/api/share', (c) => c.json(shareView(db, c.get('userId'))))

  app.put('/api/share', async (c) => {
    const userId = c.get('userId')
    const body = await c.req.json().catch(() => null) as { enabled?: unknown; rotate?: unknown } | null
    if (body?.enabled === false) {
      db.disableShare(userId)
      return c.json(shareView(db, userId))
    }
    const current = db.getShare(userId)
    const token = !current.token || body?.rotate === true ? randomBytes(16).toString('base64url') : current.token
    db.setShare(userId, { enabled: true, token })
    return c.json(shareView(db, userId))
  })

  app.get('/api/public/shelves/:token/books/:bookId/weread-redirect', (c) => {
    const ownerId = db.findEnabledShare(c.req.param('token'))
    if (!ownerId) return c.json({ error: '分享已关闭' }, 404)
    const bookId = c.req.param('bookId')
    const detail = db.getBookDetail(bookId, ownerId)
    if (!detail?.onShelf) return c.json({ error: '未找到这本书' }, 404)
    return c.redirect(wereadReaderUrl(bookId), 302)
  })

  app.get('/api/public/shelves/:token/books/:bookId', (c) => {
    const ownerId = db.findEnabledShare(c.req.param('token'))
    if (!ownerId) return c.json({ error: '分享已关闭' }, 404)
    const detail = db.getBookDetail(c.req.param('bookId'), ownerId)
    if (!detail?.onShelf) return c.json({ error: '未找到这本书' }, 404)
    return c.json(detail)
  })

  app.get('/api/public/shelves/:token', (c) => {
    const ownerId = db.findEnabledShare(c.req.param('token'))
    if (!ownerId) return c.json({ error: '分享已关闭' }, 404)
    const user = db.findUserById(ownerId)
    const link = db.getWereadLink(ownerId)
    return c.json({
      owner: link.wrName || user?.username || '',
      books: db.listOnShelf(ownerId),
      archiveGroups: db.listArchiveGroups(ownerId),
    })
  })

  app.get('/api/books', (c) => {
    const userId = c.get('userId')
    return c.json({
      books: db.listOnShelf(userId),
      archiveGroups: db.listArchiveGroups(userId),
    })
  })

  app.get('/api/map/quotes', (c) => {
    const category = c.req.query('category')?.trim() ?? ''
    if (!category) return c.json({ error: '缺少分类' }, 400)
    return c.json({ quotes: db.listMapQuotes(category, c.get('userId')) })
  })

  app.get('/api/map', (c) => c.json({ books: db.listMapBooks(c.get('userId')) }))

  app.get('/api/themes/scopes', (c) => c.json(db.listThemeScopes(now(), c.get('userId'))))

  app.get('/api/themes/highlights', (c) => {
    const scope = readScope(c.req.query('kind'), c.req.query('key'))
    if (!scope) return c.json({ error: '范围不对' }, 400)
    const themeId = c.req.query('theme')?.trim() ?? ''
    if (!themeId) return c.json({ error: '缺少主题' }, 400)
    return c.json({ highlights: db.listThemeHighlights(scope.kind, scope.key, themeId, now(), c.get('userId')) })
  })

  app.get('/api/themes', (c) => {
    const scope = readScope(c.req.query('kind'), c.req.query('key'))
    if (!scope) return c.json({ error: '范围不对' }, 400)
    return c.json(db.getThemeBoard(scope.kind, scope.key, now(), c.get('userId')))
  })

  app.post('/api/themes/cluster', async (c) => {
    const body = await c.req.json().catch(() => null) as { kind?: string; key?: string } | null
    const scope = readScope(body?.kind, body?.key)
    if (!scope) return c.json({ error: '范围不对' }, 400)
    return c.json(db.clusterThemeScope(scope.kind, scope.key, now(), c.get('userId')))
  })

  app.post('/api/themes/rename', async (c) => {
    const body = await c.req.json().catch(() => null) as { themeId?: string; name?: string } | null
    const themeId = body?.themeId?.trim() ?? ''
    if (!themeId) return c.json({ error: '缺少主题' }, 400)
    return themeError(c, db.renameTheme(themeId, body?.name ?? '', c.get('userId')))
  })

  app.post('/api/themes/merge', async (c) => {
    const body = await c.req.json().catch(() => null) as { sourceId?: string; targetId?: string } | null
    const sourceId = body?.sourceId?.trim() ?? ''
    const targetId = body?.targetId?.trim() ?? ''
    if (!sourceId || !targetId) return c.json({ error: '缺少主题' }, 400)
    return themeError(c, db.mergeThemes(sourceId, targetId, c.get('userId')))
  })

  app.post('/api/themes/move', async (c) => {
    const body = await c.req.json().catch(() => null) as {
      kind?: string
      key?: string
      bookmarkId?: string
      themeId?: string | null
      create?: boolean
    } | null
    const scope = readScope(body?.kind, body?.key)
    if (!scope) return c.json({ error: '范围不对' }, 400)
    const bookmarkId = body?.bookmarkId?.trim() ?? ''
    if (!bookmarkId) return c.json({ error: '缺少划线' }, 400)
    const result = db.moveThemeHighlight({
      kind: scope.kind,
      key: scope.key,
      bookmarkId,
      themeId: body?.themeId ?? null,
      create: body?.create === true,
      now: now(),
    }, c.get('userId'))
    if (result !== 'ok') return themeError(c, result)
    return c.json(db.getThemeBoard(scope.kind, scope.key, now(), c.get('userId')))
  })

  app.get('/api/encounter', (c) => {
    const exclude = new Set(
      (c.req.query('exclude') ?? '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 12),
    )
    const encounters = pickEncounters(db.listHighlightLines(c.get('userId')), new Date(), 3, Math.random, exclude)
    return c.json({ encounters })
  })

  app.get('/api/books/:bookId/export', (c) => {
    const detail = db.getBookDetail(c.req.param('bookId'), c.get('userId'))
    if (!detail) return c.json({ error: '未找到这本书' }, 404)
    const csv = c.req.query('format') === 'csv'
    const body = csv ? highlightsToCsv(detail) : highlightsToMarkdown(detail)
    const filename = exportFilename(detail.title, csv ? 'csv' : 'md')
    return c.body(body, 200, {
      'Content-Type': `${csv ? 'text/csv' : 'text/markdown'}; charset=utf-8`,
      'Content-Disposition': contentDisposition(filename),
    })
  })

  app.get('/api/books/:bookId/weread-redirect', (c) => {
    const bookId = c.req.param('bookId')
    if (!db.getBook(bookId, c.get('userId'))) return c.json({ error: '未找到这本书' }, 404)
    return c.redirect(wereadReaderUrl(bookId), 302)
  })

  app.get('/api/handbook', (c) => c.json(handbookView(c.get('userId'), c.req.query('id') ?? null)))

  app.get('/api/handbook/books', (c) => {
    return c.json({ books: db.searchHandbookShelf(c.req.query('q') ?? '', c.get('userId')) })
  })

  app.post('/api/handbook/write', async (c) => {
    const userId = c.get('userId')
    const body = await c.req.json().catch(() => null) as { rebuildCards?: boolean; bookIds?: unknown } | null
    const bookIds = handbookBookIds(body?.bookIds)
    if (bookIds.length === 0) return c.json({ error: '先选择 1 到 3 本书' }, 400)
    if (bookIds.length > HANDBOOK_BOOK_LIMIT) return c.json({ error: '每次最多选择 3 本书' }, 400)
    if (db.listHandbookShelfIds(bookIds, userId).length !== bookIds.length) {
      return c.json({ error: '架上没有这几本书' }, 400)
    }
    const rebuild = body?.rebuildCards === true
    const started = startHandbook(userId, async () => {
      const job = handbookJob(userId)
      const ready = new Set(db.listHandbookCards(userId).filter((card) => bookIds.includes(card.bookId)).map((card) => card.bookId))
      const toRead = rebuild ? bookIds : bookIds.filter((bookId) => !ready.has(bookId))
      if (toRead.length > 0) {
        job.phase = 'cards'
        await buildHandbookCards(db, handbookModel(), userId, toRead, (done, total, message) => {
          job.done = done
          job.total = total
          job.message = message
        })
      }
      db.retainHandbookCards(bookIds, userId)
      job.phase = 'chapters'
      await writeHandbookChapters(db, handbookModel(), userId, bookIds, (done, total, message) => {
        job.done = done
        job.total = total
        job.message = message
      })
    })
    if (!started) return c.json({ error: '手册还在写' }, 409)
    return c.json(handbookView(userId))
  })

  app.patch('/api/handbook/chapters/:position', async (c) => {
    const position = chapterPosition(c.req.param('position'))
    const userId = c.get('userId')
    if (!position) return c.json({ error: '没有这一章' }, 404)
    const body = await c.req.json().catch(() => null) as { title?: unknown; body?: unknown; handbookId?: unknown } | null
    const handbookId = resolveHandbookId(userId, typeof body?.handbookId === 'string' ? body.handbookId : null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const prose = typeof body?.body === 'string' ? body.body.trim() : ''
    if (!handbookId) return c.json({ error: '还没有这本手册' }, 404)
    if (!title || !prose) return c.json({ error: '章名和正文不能为空' }, 400)
    if (!db.listHandbookChapters(handbookId, userId).some((chapter) => chapter.position === position)) {
      return c.json({ error: '还没有这一章' }, 404)
    }
    db.updateHandbookChapter(handbookId, position, { title, body: prose }, userId)
    return c.json(handbookView(userId, handbookId))
  })

  app.post('/api/handbook/chapters/:position/rewrite', async (c) => {
    const position = chapterPosition(c.req.param('position'))
    const userId = c.get('userId')
    if (!position) return c.json({ error: '没有这一章' }, 404)
    const body = await c.req.json().catch(() => null) as { handbookId?: unknown } | null
    const handbookId = resolveHandbookId(userId, typeof body?.handbookId === 'string' ? body.handbookId : null)
    if (!handbookId || !db.listHandbookChapters(handbookId, userId).some((chapter) => chapter.position === position)) {
      return c.json({ error: '还没有这一章' }, 404)
    }
    const started = startHandbook(userId, async () => {
      const job = handbookJob(userId)
      job.phase = 'rewrite'
      job.message = `正在重写第 ${position} 章`
      await rewriteHandbookChapter(db, handbookModel(), userId, handbookId, position)
      job.message = `第 ${position} 章已重写`
    })
    if (!started) return c.json({ error: '手册还在写' }, 409)
    return c.json(handbookView(userId, handbookId))
  })

  app.post('/api/handbook/chapters/:position/draw', async (c) => {
    const position = chapterPosition(c.req.param('position'))
    const userId = c.get('userId')
    if (!position) return c.json({ error: '没有这一章' }, 404)
    const body = await c.req.json().catch(() => null) as { handbookId?: unknown } | null
    const handbookId = resolveHandbookId(userId, typeof body?.handbookId === 'string' ? body.handbookId : null)
    if (!handbookId || !db.listHandbookChapters(handbookId, userId).some((chapter) => chapter.position === position)) {
      return c.json({ error: '还没有这一章' }, 404)
    }
    const started = startHandbook(userId, async () => {
      const job = handbookJob(userId)
      job.phase = 'draw'
      job.message = `正在画第 ${position} 章`
      await drawHandbookChapter(db, handbookModel(), userId, handbookId, position, handbookImageFile(userId, handbookId, position))
      job.message = `第 ${position} 章已画出`
    })
    if (!started) return c.json({ error: '手册还在写' }, 409)
    return c.json(handbookView(userId, handbookId))
  })

  app.get('/api/handbook/chapters/:position/image', (c) => {
    const position = chapterPosition(c.req.param('position'))
    if (!position) return c.json({ error: '没有这一章' }, 404)
    const userId = c.get('userId')
    const handbookId = resolveHandbookId(userId, c.req.query('handbook') ?? null)
    if (!handbookId) return c.json({ error: '这一章还没有图' }, 404)
    const file = handbookImageFile(userId, handbookId, position)
    if (!fs.existsSync(file)) return c.json({ error: '这一章还没有图' }, 404)
    return c.body(fs.readFileSync(file), 200, { 'Content-Type': 'image/png' })
  })

  app.get('/api/books/:bookId', (c) => {
    const detail = db.getBookDetail(c.req.param('bookId'), c.get('userId'))
    if (!detail) return c.json({ error: '未找到这本书' }, 404)
    return c.json(detail)
  })

  return Object.assign(app, {
    tickAutoSync(now = Date.now()) {
      for (const userId of db.listLinkedUserIds()) {
        const last = db.latestSync(userId)
        const finished = last ? Date.parse(last.finishedAt) : 0
        if (now - finished < AUTO_SYNC_MS) continue
        startSync(userId, false)
      }
    },
  })
}

function readScope(kind: string | undefined, key: string | undefined): { kind: ScopeKind; key: string } | null {
  if (kind !== 'category' && kind !== 'group' && kind !== 'recent') return null
  if (kind === 'recent') return { kind, key: RECENT_SCOPE_KEY }
  const cleaned = key?.trim() ?? ''
  if (!cleaned) return null
  return { kind, key: cleaned }
}

function themeError(c: { json: (body: unknown, status?: number) => Response }, result: ThemeWrite) {
  if (result === 'ok') return c.json({ ok: true })
  if (result === 'missing') return c.json({ error: '未找到这个主题' }, 404)
  if (result === 'empty') return c.json({ error: '主题名不能为空' }, 400)
  if (result === 'same') return c.json({ error: '不能并进自己' }, 400)
  return c.json({ error: '这句不在当前范围里' }, 400)
}

function shareView(db: AppDatabase, userId: string) {
  const share = db.getShare(userId)
  return {
    enabled: share.enabled,
    path: share.enabled && share.token ? `/s/${share.token}` : null,
  }
}

function writeSession(c: { header: (name: string, value: string) => void }, db: AppDatabase, userId: string, secure: boolean) {
  const { token, hash } = newSessionToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  db.createSession(hash, userId, expires.toISOString())
  const secureFlag = secure ? '; Secure' : ''
  c.header('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax${secureFlag}`)
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

function allowRegister(hits: Map<string, number[]>, ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < 60_000)
  if (recent.length >= 10) return false
  recent.push(now)
  hits.set(ip, recent)
  return true
}
