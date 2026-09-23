import { Hono } from 'hono'
import type { AppDatabase } from './db'
import { groupBooks } from './shelf'
import { runSync } from './sync'
import { WereadError, type WereadClient } from './weread'
import type { SyncStatus } from '../shared/types'

export type AppOptions = {
  db: AppDatabase
  createClient: (apiKey: string) => WereadClient
}

export function createApp(options: AppOptions) {
  const { db, createClient } = options
  let running = false

  function status(): SyncStatus {
    return { running, last: db.latestSync() }
  }

  function startSync(force: boolean): SyncStatus | { error: string } {
    if (!db.getApiKey()) return { error: '尚未配置 API Key' }
    if (running) return status()
    const apiKey = db.getApiKey()
    if (!apiKey) return { error: '尚未配置 API Key' }
    running = true
    void runSync(db, createClient(apiKey), { force }).finally(() => {
      running = false
    })
    return status()
  }

  const app = new Hono()

  app.get('/api/key', (c) => c.json({ configured: db.getApiKey() != null }))

  app.put('/api/key', async (c) => {
    const body = await c.req.json().catch(() => null) as { apiKey?: unknown } | null
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!apiKey) return c.json({ error: 'API Key 无效' }, 400)
    try {
      await createClient(apiKey).call('/user/notebooks', { count: 1 })
    } catch (error) {
      const message = error instanceof WereadError ? 'API Key 无效' : 'API Key 无效'
      return c.json({ error: message }, 400)
    }
    db.setApiKey(apiKey)
    return c.json({ configured: true })
  })

  app.get('/api/sync', (c) => c.json(status()))

  app.post('/api/sync', (c) => {
    const force = c.req.query('force') === '1'
    const result = startSync(force)
    if ('error' in result) return c.json(result, 400)
    return c.json(result)
  })

  app.get('/api/books', (c) => c.json(groupBooks(db.listOnShelf())))

  app.get('/api/books/:bookId', (c) => {
    const detail = db.getBookDetail(c.req.param('bookId'))
    if (!detail) return c.json({ error: '未找到这本书' }, 404)
    return c.json(detail)
  })

  return app
}
