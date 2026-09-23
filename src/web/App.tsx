import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getBook, getBooks, getKeyStatus, getSync, saveKey, startSync } from './api'
import { formatDuration, formatProgress } from './format'
import { groupBooks } from '../server/shelf'
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
  const shelfVisible = useRef(false)

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
      if (status.running && status.total > 0 && !shelfVisible.current) {
        shelfVisible.current = true
        setLibraryVersion((version) => version + 1)
      }
      if (wasRunning.current && !status.running) {
        shelfVisible.current = false
        setLibraryVersion((version) => version + 1)
      }
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
  const [hiddenFinishedAt, setHiddenFinishedAt] = useState<string | null>(null)
  if (!status) return null
  if (status.running) {
    const progress = status.total > 0 ? ` ${status.done} / ${status.total}` : ''
    return <div className="banner">正在同步书架、划线和进度{progress}。失败的书会自动再试。</div>
  }
  if (!status.last || hiddenFinishedAt === status.last.finishedAt) return null
  return (
    <div className="banner">
      <p>
        书架 {status.last.shelfCount} 本，更新 {status.last.updated}，跳过 {status.last.skipped}，失败 {status.last.failed}
        {status.last.message ? `。${status.last.message}` : ''}
        {status.last.failed > 0 ? '。失败的书会在下一次同步时自动再试。' : ''}
      </p>
      <button type="button" className="banner-close" onClick={() => setHiddenFinishedAt(status.last?.finishedAt ?? null)}>关闭</button>
    </div>
  )
}

const shelfCacheKey = 'read-life.shelf'

function readShelfCache(): BooksResponse | null {
  try {
    const raw = localStorage.getItem(shelfCacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BooksResponse
    if (!Array.isArray(parsed.groups)) return null
    return parsed
  } catch {
    return null
  }
}

function writeShelfCache(data: BooksResponse) {
  try {
    localStorage.setItem(shelfCacheKey, JSON.stringify(data))
  } catch {
    localStorage.removeItem(shelfCacheKey)
  }
}

function Shelf({ libraryVersion }: { libraryVersion: number }) {
  const [data, setData] = useState<BooksResponse | null>(readShelfCache)
  const [error, setError] = useState('')
  const [openYear, setOpenYear] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(48)

  useEffect(() => {
    let stop = false
    void getBooks()
      .then((next) => {
        if (stop) return
        setData(next)
        setError('')
        writeShelfCache(next)
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message)
      })
    return () => {
      stop = true
    }
  }, [libraryVersion])

  if (!data) {
    if (error) return <p className="error">{error}</p>
    return <p className="muted">正在读取书架。</p>
  }
  const groups = groupBooks(data.groups.flatMap((group) => group.books)).groups
  if (groups.length === 0) return <p>书架还是空的。先在设置里保存 API Key，再同步。</p>
  const selected = groups.some((group) => group.year === openYear)
    ? openYear
    : (groups.find((group) => group.year !== '未知')?.year ?? groups[0]?.year)
  return (
    <div>
      {groups.map((group) => {
        const open = group.year === selected
        const books = open ? group.books.slice(0, visibleCount) : []
        return (
          <section key={group.year}>
            <button
              type="button"
              className={open ? 'year open' : 'year'}
              onClick={() => {
                setOpenYear(group.year)
                setVisibleCount(48)
              }}
            >
              {group.year === '未知' ? '未知' : `${group.year} 年`} · {group.books.length}
            </button>
            {open ? (
              <>
                <div className="grid">
                  {books.map((book) => (
                    <article className="card" key={book.bookId}>
                      <a href={`/book/${encodeURIComponent(book.bookId)}`}>
                        {book.cover ? <img src={book.cover} alt="" loading="lazy" /> : <div className="cover-fallback" />}
                      </a>
                      <div>
                        <h2><a href={`/book/${encodeURIComponent(book.bookId)}`}>{book.title || '未命名'}</a></h2>
                        <p className="meta">{book.author}</p>
                        <p className="meta">进度 {formatProgress(book.progress)} · 划线 {book.highlightCount}</p>
                        <a className="weread-link" href={book.wereadUrl} target="_blank" rel="noreferrer">微信读书</a>
                      </div>
                    </article>
                  ))}
                </div>
                {group.books.length > books.length ? (
                  <button type="button" className="more" onClick={() => setVisibleCount((count) => count + 48)}>
                    再显示 {Math.min(48, group.books.length - books.length)} 本
                  </button>
                ) : null}
              </>
            ) : null}
          </section>
        )
      })}
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
          <p><a className="weread-link" href={book.wereadUrl} target="_blank" rel="noreferrer">在微信读书打开</a></p>
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
