import fs from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app'
import { openDatabase } from './db'
import { createWereadClient } from './weread'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const port = Number(process.env.PORT ?? 8787)
const dbPath = process.env.READ_LIFE_DB ?? path.join(root, 'data', 'read-life.sqlite')

const db = openDatabase(dbPath)
const app = createApp({ db, createClient: (apiKey) => createWereadClient(apiKey) })
const production = process.env.NODE_ENV === 'production'

if (production) {
  app.use('/assets/*', serveStatic({ root: path.join(root, 'dist') }))
  app.get('*', (c) => c.html(fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')))
  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
    console.log(`阅读生活已在 http://127.0.0.1:${info.port} 打开`)
  })
} else {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: 'spa',
  })
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    if (url.startsWith('/api')) {
      await sendFetchResponse(res, await app.fetch(await nodeRequest(req)))
      return
    }
    vite.middlewares(req, res, () => {
      res.statusCode = 404
      res.end()
    })
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`阅读生活已在 http://127.0.0.1:${port} 打开`)
  })
}

async function nodeRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? '127.0.0.1'
  const method = req.method ?? 'GET'
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
    else headers.set(key, value)
  }
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(`http://${host}${req.url}`, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) as ReadableStream : undefined,
    duplex: 'half',
  } as RequestInit)
}

async function sendFetchResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(value)
  }
  res.end()
}
