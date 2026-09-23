import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getBook, getBooks, getKeyStatus, getSync, saveKey, startSync } from './api'
import { formatDuration, formatProgress } from './format'
import { BookCard } from './BookCard'
import { ShelfBrowse } from './ShelfBrowse'
import { LoadMoreSentinel } from './LoadMoreSentinel'
import { SurpriseToolbar } from './SurpriseToolbar'
import { applyRandomOrder, buildShelfSections, type ShelfMode } from './shelf-views'
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
  const [notifySyncAt, setNotifySyncAt] = useState<string | null>(null)

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
        if (status.last?.finishedAt) setNotifySyncAt(status.last.finishedAt)
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

  const onShelf = route.name === 'shelf'
  const onBook = route.name === 'book'

  return (
    <div className={`app app-${route.name}`}>
      <header className={onShelf ? 'topbar topbar-shelf' : 'topbar'}>
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); go('/') }}>阅读生活</a>
        <nav className={onShelf ? 'nav nav-minimal' : 'nav'}>
          {onShelf ? (
            <>
              <button type="button" className="nav-text" onClick={() => void syncNow(false)} disabled={sync?.running}>
                {sync?.running ? '同步中…' : '同步'}
              </button>
              <button type="button" className="nav-text" onClick={() => void syncNow(true)} disabled={sync?.running}>
                强制同步
              </button>
            </>
          ) : null}
          <a
            className={onShelf || onBook ? 'nav-text' : undefined}
            href="/settings"
            onClick={(event) => { event.preventDefault(); go('/settings') }}
          >
            设置
          </a>
        </nav>
      </header>
      {notice ? <p className="error">{notice}</p> : null}
      <SyncBanner status={sync} notifySyncAt={notifySyncAt} />
      {route.name === 'settings' ? <Settings /> : null}
      {route.name === 'shelf' ? <Shelf libraryVersion={libraryVersion} /> : null}
      {route.name === 'book' ? (
        <BookPage bookId={route.bookId} libraryVersion={libraryVersion} onBack={() => go('/')} />
      ) : null}
    </div>
  )
}

const syncBannerDismissKey = 'read-life.sync-banner-dismissed'

function readDismissedSync(): string | null {
  try {
    return localStorage.getItem(syncBannerDismissKey)
  } catch {
    return null
  }
}

function writeDismissedSync(finishedAt: string) {
  try {
    localStorage.setItem(syncBannerDismissKey, finishedAt)
  } catch {
    // ignore
  }
}

function SyncBanner({ status, notifySyncAt }: { status: SyncStatus | null; notifySyncAt: string | null }) {
  const [dismissedAt, setDismissedAt] = useState<string | null>(() => readDismissedSync())

  if (!status) return null
  if (status.running) {
    const progress = status.total > 0 ? ` ${status.done} / ${status.total}` : ''
    return (
      <div className="banner banner-sync" role="status">
        <p>正在同步书架、划线和进度{progress}。失败的书会自动再试。</p>
      </div>
    )
  }
  if (!status.last) return null
  if (dismissedAt === status.last.finishedAt) return null
  if (notifySyncAt !== status.last.finishedAt) return null
  return (
    <div className="banner banner-done">
      <p>
        同步完成：书架 {status.last.shelfCount} 本，更新 {status.last.updated}，跳过 {status.last.skipped}
        {status.last.failed > 0 ? `，失败 ${status.last.failed}` : ''}
        {status.last.message ? `。${status.last.message}` : ''}
      </p>
      <button
        type="button"
        className="banner-close"
        aria-label="关闭同步提示"
        onClick={() => {
          const finishedAt = status.last?.finishedAt ?? ''
          writeDismissedSync(finishedAt)
          setDismissedAt(finishedAt)
        }}
      >
        知道了
      </button>
    </div>
  )
}

const shelfCacheKey = 'read-life.shelf.v2'
const shelfModeKey = 'read-life.shelf-mode'
const shelfRandomOrderKey = 'read-life.shelf-random-order'

const shelfModes: Array<{ id: ShelfMode; label: string }> = [
  { id: 'archive', label: '分组' },
  { id: 'progress', label: '进度' },
  { id: 'rating', label: '推荐值' },
  { id: 'category', label: '分类' },
  { id: 'random', label: '随机' },
]

function readShelfMode(): ShelfMode {
  const saved = localStorage.getItem(shelfModeKey)
  return shelfModes.some((mode) => mode.id === saved) ? (saved as ShelfMode) : 'archive'
}

function readRandomOrder(): boolean {
  return localStorage.getItem(shelfRandomOrderKey) === '1'
}

function readShelfCache(): BooksResponse | null {
  try {
    const raw = localStorage.getItem(shelfCacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BooksResponse
    if (!Array.isArray(parsed.books) || !Array.isArray(parsed.archiveGroups)) return null
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
  const [mode, setMode] = useState<ShelfMode>(readShelfMode)
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(48)
  const [randomOrder, setRandomOrder] = useState(readRandomOrder)
  const [shuffleSeed, setShuffleSeed] = useState(() => Date.now())

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

  useEffect(() => {
    localStorage.setItem(shelfModeKey, mode)
    setOpenSection(null)
    setVisibleCount(48)
    if (mode === 'random') {
      setRandomOrder(true)
      setShuffleSeed(Date.now())
    }
  }, [mode])

  useEffect(() => {
    localStorage.setItem(shelfRandomOrderKey, randomOrder ? '1' : '0')
  }, [randomOrder])

  if (!data) {
    if (error) return <p className="error">{error}</p>
    return <p className="state-message">正在打开书架…</p>
  }
  if (data.books.length === 0) {
    return <p className="state-message">书架还是空的。先在设置里保存 API Key，再同步。</p>
  }

  const baseSections = buildShelfSections(data.books, data.archiveGroups, mode)
  const shuffleOn = randomOrder || mode === 'random'
  const browseMode = mode === 'archive' || mode === 'category'
  const sections = browseMode
    ? baseSections
    : shuffleOn
      ? applyRandomOrder(baseSections, shuffleSeed)
      : baseSections
  return (
    <div className="shelf">
      <header className="shelf-intro">
        <p className="shelf-eyebrow">我的书架</p>
        <h1 className="shelf-headline">
          <span className="shelf-count-num">{data.books.length.toLocaleString('zh-CN')}</span>
          <span className="shelf-count-label">本书在架上</span>
        </h1>
        <p className="shelf-lede">按自己的节奏浏览，不必一次看完。</p>
      </header>

      <div className="shelf-modes" role="tablist" aria-label="浏览方式">
        {shelfModes.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            className={mode === item.id ? 'mode active' : 'mode'}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <SurpriseToolbar
        showToggle={mode !== 'random'}
        active={randomOrder}
        shuffleOn={shuffleOn}
        onToggle={() => {
          setRandomOrder((on) => {
            if (!on) setShuffleSeed(Date.now())
            return !on
          })
        }}
        onReshuffle={() => setShuffleSeed(Date.now())}
      />

      {browseMode ? (
        <ShelfBrowse
          variant={mode}
          sections={baseSections}
          totalBooks={data.books.length}
          storageKey={`read-life.browse.${mode}`}
          randomOrder={shuffleOn}
          shuffleSeed={shuffleSeed}
        />
      ) : (
        sections.map((section) => {
          const open = section.key === openSection
          const books = open ? section.books.slice(0, visibleCount) : []
          return (
            <section key={section.key} className={open ? 'shelf-section open' : 'shelf-section'}>
              <button
                type="button"
                className={open ? 'section-head open' : 'section-head'}
                aria-expanded={open}
                onClick={() => {
                  setOpenSection(open ? null : section.key)
                  setVisibleCount(48)
                }}
              >
                <span className="section-label">{section.label}</span>
                <span className="section-count">{section.books.length}</span>
              </button>
              {open ? (
                <div className="section-body">
                  <div className="grid">
                    {books.map((book) => (
                      <BookCard book={book} key={book.bookId} />
                    ))}
                  </div>
                  <LoadMoreSentinel
                    hasMore={section.books.length > books.length}
                    onLoadMore={() => setVisibleCount((count) => count + 48)}
                  />
                </div>
              ) : null}
            </section>
          )
        })
      )}

      {mode === 'category' && data.books.some((book) => !book.category) ? (
        <p className="muted shelf-note">部分书的分类还在同步中。</p>
      ) : null}
    </div>
  )
}

function BookPage({
  bookId,
  libraryVersion,
  onBack,
}: {
  bookId: string
  libraryVersion: number
  onBack: () => void
}) {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void getBook(bookId).then(setBook).catch((reason: Error) => setError(reason.message))
  }, [bookId, libraryVersion])

  if (error) return <p className="error">{error}</p>
  if (!book) return <p className="state-message">正在打开这本书…</p>
  return (
    <article className="book-page">
      <a
        className="book-back"
        href="/"
        onClick={(event) => {
          event.preventDefault()
          onBack()
        }}
      >
        返回书架
      </a>
      <header className="book-head">
        {book.cover ? <img src={book.cover} alt="" /> : <div className="book-cover" />}
        <div>
          <h1>{book.title || '未命名'}</h1>
          <p className="meta">{book.author}</p>
          <div className="stats">
            <span>{formatProgress(book.progress, book.finishReading)}</span>
            <span>{formatDuration(book.readingTimeSeconds)}</span>
            <span>{book.highlightCount} 条划线</span>
          </div>
          <p className="book-actions">
            <a className="weread-link" href={book.wereadUrl} target="_blank" rel="noreferrer">在微信读书继续读</a>
          </p>
          {book.onShelf ? null : <p className="muted book-aside">不在书架上，划线仍保留。</p>}
        </div>
      </header>
      {book.chapters.length === 0 ? (
        <p className="state-message">这本书还没有划线。</p>
      ) : (
        <div className="reading-body">
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
        </div>
      )}
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
