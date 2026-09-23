import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getBook, getBooks, getKeyStatus, getSync, saveKey, startSync } from './api'
import { formatDuration, formatProgress } from './format'
import type { BookDetail, BooksResponse, SyncStatus } from '../shared/types'

type Route =
  | { name: 'shelf' }
  | { name: 'settings' }
  | { name: 'book'; bookId: string }

function readRoute(): Route {
  const path = window.location.pathname
  if (path === '/settings') return { name: 'settings' }
  if (path.startsWith('/book/')) return { name: 'book', bookId: decodeURIComponent(path.slice('/book/'.length)) }
  return { name: 'shelf' }
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [notice, setNotice] = useState('')
  const [libraryVersion, setLibraryVersion] = useState(0)
  const wasRunning = useRef(false)

  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let stop = false
    async function poll() {
      const status = await getSync()
      if (stop) return
      setSync(status)
      if (wasRunning.current && !status.running) setLibraryVersion((version) => version + 1)
      wasRunning.current = status.running
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [])

  function go(href: string) {
    window.history.pushState({}, '', href)
    setRoute(readRoute())
  }

  async function syncNow(force: boolean) {
    setNotice('')
    try {
      const status = await startSync(force)
      setSync(status)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '同步没有开始')
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); go('/') }}>阅读生活</a>
        <nav className="nav">
          <button type="button" onClick={() => void syncNow(false)} disabled={sync?.running}>同步</button>
          <button type="button" onClick={() => void syncNow(true)} disabled={sync?.running}>强制同步</button>
          <a href="/settings" onClick={(event) => { event.preventDefault(); go('/settings') }}>设置</a>
        </nav>
      </header>
      {notice ? <p className="error">{notice}</p> : null}
      <SyncBanner status={sync} />
      {route.name === 'settings' ? <Settings /> : null}
      {route.name === 'shelf' ? <Shelf libraryVersion={libraryVersion} /> : null}
      {route.name === 'book' ? <BookPage bookId={route.bookId} libraryVersion={libraryVersion} /> : null}
    </div>
  )
}

function SyncBanner({ status }: { status: SyncStatus | null }) {
  if (!status) return null
  if (status.running) return <div className="banner">正在同步书架、划线和进度。</div>
  if (!status.last) return null
  if (status.last.message) return <div className="banner"><strong>这次同步没有写入书架</strong>{status.last.message}</div>
  return (
    <div className="banner">
      书架 {status.last.shelfCount} 本，更新 {status.last.updated}，跳过 {status.last.skipped}，失败 {status.last.failed}
      {status.last.errors.length > 0 ? <span className="muted">。{status.last.errors.map((error) => `${error.bookId} ${error.message}`).join('；')}</span> : null}
    </div>
  )
}

function Shelf({ libraryVersion }: { libraryVersion: number }) {
  const [data, setData] = useState<BooksResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void getBooks().then(setData).catch((reason: Error) => setError(reason.message))
  }, [libraryVersion])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">正在读取书架。</p>
  if (data.groups.length === 0) return <p>书架还是空的。先在设置里保存 API Key，再同步。</p>
  return (
    <div>
      {data.groups.map((group) => (
        <section key={group.year}>
          <h2 className="year">{group.year === '未知' ? '未知' : `${group.year} 年`}</h2>
          <div className="grid">
            {group.books.map((book) => (
              <a className="card" key={book.bookId} href={`/book/${encodeURIComponent(book.bookId)}`}>
                {book.cover ? <img src={book.cover} alt="" /> : <div className="cover-fallback" />}
                <div>
                  <h2>{book.title || '未命名'}</h2>
                  <p className="meta">{book.author}</p>
                  <p className="meta">进度 {formatProgress(book.progress)} · 划线 {book.highlightCount}</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function BookPage({ bookId, libraryVersion }: { bookId: string; libraryVersion: number }) {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void getBook(bookId).then(setBook).catch((reason: Error) => setError(reason.message))
  }, [bookId, libraryVersion])

  if (error) return <p className="error">{error}</p>
  if (!book) return <p className="muted">正在打开这本书。</p>
  return (
    <article>
      <header className="book-head">
        {book.cover ? <img src={book.cover} alt="" /> : <div className="book-cover" />}
        <div>
          <h1>{book.title || '未命名'}</h1>
          <p className="meta">{book.author}</p>
          <div className="stats">
            <span>进度 {formatProgress(book.progress)}</span>
            <span>阅读 {formatDuration(book.readingTimeSeconds)}</span>
            <span>划线 {book.highlightCount}</span>
          </div>
          {book.onShelf ? null : <p className="muted">这本书当前不在书架上，划线仍保留。</p>}
        </div>
      </header>
      {book.chapters.length === 0 ? <p>这本书还没有划线。</p> : null}
      {book.chapters.map((chapter) => (
        <section className="chapter" key={chapter.chapterUid}>
          <h2>{chapter.title}</h2>
          {chapter.highlights.map((highlight) => (
            <blockquote className="highlight" key={highlight.bookmarkId}>
              <p>{highlight.markText}</p>
            </blockquote>
          ))}
        </section>
      ))}
    </article>
  )
}

function Settings() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void getKeyStatus().then((status) => setConfigured(status.configured))
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      await saveKey(apiKey)
      setConfigured(true)
      setApiKey('')
      setMessage('API Key 已保存。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '没有保存')
    }
  }

  return (
    <form className="settings" onSubmit={(event) => void onSubmit(event)}>
      <h1>微信读书 API Key</h1>
      <p className="muted">
        {configured ? '这台电脑上已经有 Key。保存新的 Key 之前会先向微信读书确认。' : '还没有 Key。Key 只存在这台电脑上。'}
      </p>
      <input
        type="password"
        name="apiKey"
        autoComplete="off"
        value={apiKey}
        placeholder="粘贴 API Key"
        onChange={(event) => setApiKey(event.target.value)}
      />
      <button className="primary" type="submit">保存</button>
      {message ? <p>{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </form>
  )
}
