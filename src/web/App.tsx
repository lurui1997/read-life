import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { getBook, getBooks, getEncounter, getKeyStatus, getMe, getPublicBook, getPublicShelf, getShare, getSync, loginAccount, logoutAccount, pollWereadLogin, registerAccount, saveKey, saveShare, startSync, startWereadLogin, unlinkWeread, type AuthMe, type ShareStatus } from './api'
import { formatDuration, formatProgress } from './format'
import { BookCard } from './BookCard'
import { ReadingMap } from './ReadingMap'
import { ShelfBrowse } from './ShelfBrowse'
import { FeatureShowcase, readShowcaseDismissed } from './FeatureShowcase'
import { LoadMoreSentinel } from './LoadMoreSentinel'
import { SurpriseToolbar } from './SurpriseToolbar'
import { applyRandomOrder, buildShelfSections, type ShelfMode } from './shelf-views'
import { bookmarkIdFromHash, encounterHref, type Encounter } from '../shared/encounter'
import type { BookDetail, BooksResponse, SyncStatus } from '../shared/types'
import { applyTheme, readThemePreference, themeOptions, writeThemePreference, type ThemePreference } from './theme'

type Route =
  | { name: 'shelf' }
  | { name: 'settings' }
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'book'; bookId: string }
  | { name: 'map' }
  | { name: 'share'; token: string; bookId: string | null }

function readRoute(): Route {
  const path = window.location.pathname
  const share = path.match(/^\/s\/([^/]+)(?:\/book\/(.+))?$/)
  if (share?.[1]) {
    return {
      name: 'share',
      token: decodeURIComponent(share[1]),
      bookId: share[2] ? decodeURIComponent(share[2]) : null,
    }
  }
  if (path === '/settings') return { name: 'settings' }
  if (path === '/login') return { name: 'login' }
  if (path === '/register') return { name: 'register' }
  if (path === '/map') return { name: 'map' }
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
  const [me, setMe] = useState<AuthMe | null>(null)
  const [liveTick, setLiveTick] = useState(0)
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference())

  useEffect(() => {
    void getMe().then((next) => {
      setMe(next)
      if (next.authRequired && next.user && (route.name === 'login' || route.name === 'register')) {
        window.history.replaceState({}, '', '/')
        setRoute({ name: 'shelf' })
      }
    }).catch(() => setMe(null))
  }, [route.name])

  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (route.name !== 'shelf') return
    const topbar = document.querySelector('.topbar')
    if (!(topbar instanceof HTMLElement)) return
    const apply = () => {
      document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(topbar)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--topbar-h')
    }
  }, [route.name])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (readThemePreference() === 'system') applyTheme('system')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (route.name === 'login' || route.name === 'register' || route.name === 'share') return
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
  }, [route.name])

  useEffect(() => {
    if (!sync?.running || sync.phase !== 'books') return
    const timer = window.setInterval(() => setLiveTick((tick) => tick + 1), 2000)
    return () => window.clearInterval(timer)
  }, [sync?.running, sync?.phase])

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
  const shelfChrome = onShelf || route.name === 'settings'
  const minimalNav = shelfChrome || onBook

  return (
    <div className={`app app-${route.name}`}>
      <header className={shelfChrome ? 'topbar topbar-shelf' : 'topbar'}>
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); go('/') }}>
          <span className="brand-mark" aria-hidden="true" />
          折角
        </a>
        <nav className={minimalNav ? 'nav nav-minimal' : 'nav'}>
          <button
            type="button"
            className="nav-text theme-toggle"
            onClick={() => {
              const order: ThemePreference[] = ['light', 'dark', 'system']
              const next = order[(order.indexOf(theme) + 1) % order.length] ?? 'system'
              setTheme(next)
              writeThemePreference(next)
            }}
          >
            {themeOptions.find((item) => item.id === theme)?.label ?? '跟随系统'}
          </button>
          {route.name === 'share' ? null : me?.authRequired && !me.user ? (
            <a className="nav-text" href="/login" onClick={(event) => { event.preventDefault(); go('/login') }}>登录</a>
          ) : (
            <>
              <a className="nav-text nav-map" href="/map" onClick={(event) => { event.preventDefault(); go('/map') }}>地图</a>
              <a
                className={minimalNav ? 'nav-text' : undefined}
                href="/settings"
                onClick={(event) => { event.preventDefault(); go('/settings') }}
              >
                设置
              </a>
            </>
          )}
        </nav>
      </header>
      {notice ? <p className="error">{notice}</p> : null}
      {route.name === 'share' ? null : <SyncBanner status={sync} notifySyncAt={notifySyncAt} />}
      {route.name === 'login' ? <AuthForm mode="login" onDone={() => go('/')} /> : null}
      {route.name === 'register' ? <AuthForm mode="register" onDone={() => go('/')} /> : null}
      {route.name === 'settings' ? (
        <Settings
          sync={sync}
          libraryVersion={libraryVersion}
          themePreference={theme}
          onTheme={(next) => {
            setTheme(next)
            writeThemePreference(next)
          }}
          onSync={syncNow}
          onBack={() => go('/')}
          onOpenGuide={() => {
            try {
              localStorage.removeItem('read-life.feature-showcase-dismissed')
            } catch {
              // ignore
            }
            go('/?guide=1')
          }}
        />
      ) : null}
      {route.name === 'shelf' ? (
        <Shelf
          libraryVersion={libraryVersion}
          liveTick={liveTick}
          syncing={sync?.running === true}
          freshIds={sync?.recent.map((item) => item.bookId) ?? []}
        />
      ) : null}
      {route.name === 'share' && route.bookId == null ? <ShareShelf token={route.token} /> : null}
      {route.name === 'share' && route.bookId != null ? (
        <BookPage
          bookId={route.bookId}
          libraryVersion={libraryVersion}
          shared
          shareToken={route.token}
          onBack={() => go(`/s/${encodeURIComponent(route.token)}`)}
        />
      ) : null}
      {route.name === 'map' ? <ReadingMap onClose={() => go('/')} onOpen={(href) => go(href)} /> : null}
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

function syncLine(status: SyncStatus): string {
  const latest = status.recent?.[0]
  const just = latest
    ? latest.outcome === 'failed'
      ? `最近失败：《${latest.title || '未命名'}》`
      : `刚刚更新：《${latest.title || '未命名'}》`
    : ''
  if (status.total > 0) {
    const percent = Math.round((status.done / status.total) * 100)
    const head = `正在同步进度和划线，${status.done} / ${status.total}（${percent}%）`
    return just ? `${head}。${just}` : head
  }
  if (status.phase === 'notes' || status.notesSeen > 0) {
    const seen = status.phase === 'notes' ? status.done : status.notesSeen
    return seen > 0 ? `正在读取划线目录，已看到 ${seen} 本` : '正在读取划线目录'
  }
  return '正在读取书架'
}

function SyncBanner({ status, notifySyncAt }: { status: SyncStatus | null; notifySyncAt: string | null }) {
  const [dismissedAt, setDismissedAt] = useState<string | null>(() => readDismissedSync())

  if (!status) return null
  if (status.running) {
    const known = status.total > 0
    const percent = known ? Math.min(100, Math.round((status.done / status.total) * 100)) : 0
    return (
      <div className="banner banner-sync" role="status" aria-live="polite">
        <p>{syncLine(status)}</p>
        <div
          className={known ? 'sync-track' : 'sync-track is-indeterminate'}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={known ? status.total : undefined}
          aria-valuenow={known ? status.done : undefined}
          aria-label={syncLine(status)}
        >
          <span style={known ? { width: `${percent}%` } : undefined} />
        </div>
        {(status.recent?.length ?? 0) > 0 ? (
          <ul className="sync-recent">
            {status.recent.slice(0, 3).map((item) => (
              <li key={item.bookId}>{item.outcome === 'failed' ? '失败' : '已更新'} · {item.title || '未命名'}</li>
            ))}
          </ul>
        ) : null}
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
/** ponytail: 大书架 JSON 写 localStorage 会阻塞主线程，超过此数量不缓存 */
const shelfCacheMaxBooks = 800
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
  if (data.books.length > shelfCacheMaxBooks) {
    try {
      localStorage.removeItem(shelfCacheKey)
    } catch {
      // ignore
    }
    return
  }
  try {
    localStorage.setItem(shelfCacheKey, JSON.stringify(data))
  } catch {
    localStorage.removeItem(shelfCacheKey)
  }
}

function Shelf({
  libraryVersion,
  liveTick = 0,
  syncing,
  freshIds = [],
  loadBooks,
  bookPath,
  externalPath,
  emptyMessage,
}: {
  libraryVersion: number
  liveTick?: number
  syncing: boolean
  freshIds?: string[]
  loadBooks?: () => Promise<BooksResponse>
  bookPath?: (bookId: string) => string
  externalPath?: (bookId: string) => string
  emptyMessage?: string
}) {
  const shared = Boolean(loadBooks)
  const fresh = new Set(freshIds)
  const [data, setData] = useState<BooksResponse | null>(shared ? null : readShelfCache)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<ShelfMode>(readShelfMode)
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(48)
  const [randomOrder, setRandomOrder] = useState(readRandomOrder)
  const [shuffleSeed, setShuffleSeed] = useState(() => Date.now())
  const [showcaseVisible, setShowcaseVisible] = useState(() => {
    const guide = new URLSearchParams(window.location.search).get('guide') === '1'
    return guide || !readShowcaseDismissed()
  })
  const [encounters, setEncounters] = useState<Encounter[]>([])
  const toolsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('guide') === '1') {
      setShowcaseVisible(true)
      window.history.replaceState({}, '', '/')
    }
  }, [])

  useEffect(() => {
    let stop = false
    void (loadBooks ?? getBooks)()
      .then((next) => {
        if (stop) return
        setData(next)
        setError('')
        if (!shared) writeShelfCache(next)
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message)
      })
    return () => {
      stop = true
    }
  }, [libraryVersion, liveTick, loadBooks, shared])

  useEffect(() => {
    if (shared) return
    let stop = false
    void getEncounter()
      .then((next) => {
        if (!stop) setEncounters(next.encounters)
      })
      .catch(() => {
        if (!stop) setEncounters([])
      })
    return () => {
      stop = true
    }
  }, [libraryVersion, shared])

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

  useEffect(() => {
    const node = toolsRef.current
    if (!node) return
    const apply = () => {
      document.documentElement.style.setProperty('--shelf-tools-h', `${node.offsetHeight}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--shelf-tools-h')
    }
  }, [data, mode, randomOrder])

  if (!data) {
    if (error) return <p className="error">{error}</p>
    return <p className="state-message">正在打开书架…</p>
  }
  if (data.books.length === 0) {
    if (syncing) return <p className="state-message">书还在路上，进度见上方。</p>
    return <p className="state-message">{emptyMessage ?? '书架还是空的。到设置里绑定微信读书，再同步一次。'}</p>
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
      {!shared && encounters.length > 0 ? (
        <section className="encounter-block" aria-label="随机划线">
          {encounters.map((encounter) => (
            <a className="encounter" href={encounterHref(encounter.bookId, encounter.bookmarkId)} key={encounter.bookmarkId}>
              <p className="encounter-line">{encounter.markText}</p>
              <span className="encounter-meta">
                <span className="encounter-title">{encounter.title || '未命名'}</span>
                <span className="encounter-go">去这一章</span>
              </span>
            </a>
          ))}
          <button
            type="button"
            className="encounter-refresh"
            onClick={() => {
              void getEncounter(encounters.map((item) => item.bookmarkId))
                .then((next) => setEncounters(next.encounters))
                .catch(() => setEncounters([]))
            }}
          >
            重新随机
          </button>
        </section>
      ) : null}
      {!shared && showcaseVisible ? (
        <FeatureShowcase
          onDismiss={() => setShowcaseVisible(false)}
          onTrySurprise={() => {
            setRandomOrder(true)
            setShuffleSeed(Date.now())
          }}
        />
      ) : null}

      <div className="shelf-tools" ref={toolsRef}>
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
      </div>

      {browseMode ? (
        <ShelfBrowse
          variant={mode}
          sections={baseSections}
          totalBooks={data.books.length}
          storageKey={`read-life.browse.${mode}${shared ? '.share' : ''}`}
          randomOrder={shuffleOn}
          shuffleSeed={shuffleSeed}
          bookPath={bookPath}
          externalPath={externalPath}
          freshIds={fresh}
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
                      <BookCard
                        book={book}
                        key={book.bookId}
                        href={bookPath?.(book.bookId)}
                        externalHref={externalPath?.(book.bookId)}
                        fresh={fresh.has(book.bookId)}
                      />
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
  shared = false,
  shareToken,
}: {
  bookId: string
  libraryVersion: number
  onBack: () => void
  shared?: boolean
  shareToken?: string
}) {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const request = shareToken ? getPublicBook(shareToken, bookId) : getBook(bookId)
    void request.then(setBook).catch((reason: Error) => setError(reason.message))
  }, [bookId, libraryVersion, shareToken])

  useEffect(() => {
    if (!book) return
    const bookmarkId = bookmarkIdFromHash(window.location.hash)
    if (!bookmarkId) return
    const node = document.querySelector(`[data-bookmark="${CSS.escape(bookmarkId)}"]`)
    if (!(node instanceof HTMLElement)) return
    node.classList.add('is-encounter')
    node.scrollIntoView({ block: 'center' })
  }, [book])

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
        <div className="book-head-copy">
          <h1>{book.title || '未命名'}</h1>
          <p className="meta">{book.author}</p>
          <div className="stats">
            <span>{formatProgress(book.progress, book.finishReading)}</span>
            <span>{formatDuration(book.readingTimeSeconds)}</span>
            <span>{book.highlightCount} 条划线</span>
          </div>
          {book.onShelf ? null : <p className="muted book-aside">不在书架上，划线仍保留。</p>}
        </div>
        <p className="book-actions">
          <a className="weread-link weread-link-primary" href={book.wereadUrl} target="_blank" rel="noreferrer">在微信读书继续读</a>
          {!shared && book.highlightCount > 0 ? (
            <>
              <a className="weread-link weread-link-quiet" href={`/api/books/${encodeURIComponent(book.bookId)}/export`}>导出 Markdown</a>
              <a className="weread-link weread-link-quiet" href={`/api/books/${encodeURIComponent(book.bookId)}/export?format=csv`}>导出 CSV</a>
            </>
          ) : null}
        </p>
      </header>
      {book.chapters.length === 0 ? (
        <p className="state-message">这本书还没有划线。</p>
      ) : (
        <div className="reading-body">
          {book.chapters.map((chapter) => (
            <section className="chapter" key={chapter.chapterUid}>
              <h2>{chapter.title}</h2>
              {chapter.highlights.map((highlight) => (
                <blockquote className="highlight" data-bookmark={highlight.bookmarkId} key={highlight.bookmarkId}>
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

function AuthForm({ mode, onDone }: { mode: 'login' | 'register'; onDone: () => void }) {
  const [login, setLogin] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      if (mode === 'login') await loginAccount({ login, password })
      else await registerAccount({ username, email, password })
      onDone()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '没有完成')
    }
  }

  return (
    <form className="settings-page settings-form" onSubmit={(event) => void onSubmit(event)}>
      <h1>{mode === 'login' ? '登录' : '注册'}</h1>
      {mode === 'login' ? (
        <input value={login} placeholder="用户名或邮箱" onChange={(event) => setLogin(event.target.value)} />
      ) : (
        <>
          <input value={username} placeholder="用户名" onChange={(event) => setUsername(event.target.value)} />
          <input value={email} placeholder="邮箱" onChange={(event) => setEmail(event.target.value)} />
        </>
      )}
      <input type="password" value={password} placeholder="密码" onChange={(event) => setPassword(event.target.value)} />
      <button className="primary" type="submit">{mode === 'login' ? '登录' : '注册'}</button>
      {error ? <p className="error">{error}</p> : null}
      {mode === 'login' ? (
        <a href="/register" onClick={(event) => { event.preventDefault(); window.history.pushState({}, '', '/register'); window.dispatchEvent(new PopStateEvent('popstate')) }}>没有账号？注册</a>
      ) : (
        <a href="/login" onClick={(event) => { event.preventDefault(); window.history.pushState({}, '', '/login'); window.dispatchEvent(new PopStateEvent('popstate')) }}>已有账号？登录</a>
      )}
    </form>
  )
}

function AccountPanel() {
  const [me, setMe] = useState<AuthMe | null>(null)
  useEffect(() => {
    void getMe().then(setMe).catch(() => setMe(null))
  }, [])
  if (!me?.authRequired || !me.user) return null
  return (
    <div className="settings-account">
      <h3>账号</h3>
      <p className="muted">{me.user.username} · {me.user.email}</p>
      <button
        type="button"
        className="settings-secondary"
        onClick={() => {
          void logoutAccount().then(() => window.location.assign('/login'))
        }}
      >
        退出登录
      </button>
    </div>
  )
}

function WereadBind({
  configured,
  wrName,
  bookCount,
  syncing,
  onSync,
  onChange,
}: {
  configured: boolean | null
  wrName: string | null
  bookCount: number | null
  syncing: boolean
  onSync: () => void
  onChange: () => void
}) {
  const [qr, setQr] = useState('')
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')

  async function begin() {
    setError('')
    setHint('正在生成二维码…')
    const started = await startWereadLogin()
    setQr(started.qrDataUrl)
    setHint('请用微信扫描二维码')
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const result = await pollWereadLogin(started.loginId)
      if (result.status === 'done') {
        setHint(result.wrName ? `已绑定 ${result.wrName}` : '已绑定微信读书')
        setQr('')
        onChange()
        return
      }
      if (result.status === 'error') {
        setError(result.error ?? '扫码失败')
        setQr('')
        return
      }
    }
    setError('等待超时，请重试')
  }

  const needsSync = configured === true && bookCount === 0 && !syncing
  const displayName = wrName || ''

  return (
    <section className="settings-panel settings-bind">
      <div className="settings-bind-head">
        <h2>微信读书</h2>
        {configured ? <span className="settings-pill">已绑定</span> : <span className="settings-pill settings-pill-wait">未绑定</span>}
      </div>
      {configured ? (
        <p className="settings-bind-name">{displayName || '已连接'}</p>
      ) : (
        <p className="muted">用微信扫码，把你的书架接到这个账号上。</p>
      )}
      {needsSync ? <p className="settings-bind-next">书架还是空的。同步一次，书就会出现。</p> : null}
      {qr ? (
        <div className="settings-qr">
          <img src={qr} alt="微信读书登录二维码" width={196} height={196} />
          <p>打开微信，扫一扫</p>
        </div>
      ) : null}
      <div className="settings-actions">
        {needsSync ? (
          <button type="button" className="primary" onClick={onSync} disabled={syncing}>
            {syncing ? '同步中…' : '同步书架'}
          </button>
        ) : null}
        <button type="button" className={needsSync ? 'settings-secondary' : 'primary'} onClick={() => void begin().catch((reason: Error) => setError(reason.message))}>
          {configured ? '更换账号' : '扫码绑定'}
        </button>
        {configured ? (
          <button type="button" className="settings-secondary" onClick={() => void unlinkWeread().then(() => { setHint(''); onChange() })}>
            解除绑定
          </button>
        ) : null}
      </div>
      {hint && !hint.startsWith('已绑定') ? <p className="muted settings-bind-hint">{hint}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <AccountPanel />
    </section>
  )
}

function autoSyncLine(sync: SyncStatus | null): string {
  if (!sync?.auto) return '每小时自动更新。也可以随时手动更新。'
  if (sync.running) return '正在更新。结束后大约一小时会再自动更新一次。'
  if (!sync.auto.nextAt) return '绑定微信读书后，每小时自动更新。'
  const next = new Date(sync.auto.nextAt)
  if (Number.isNaN(next.getTime()) || next.getTime() <= Date.now()) return '每小时自动更新。这一轮即将开始。'
  const clock = next.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return `每小时自动更新。下次大约 ${clock}。也可以随时手动更新。`
}

function ThemePanel({ preference, onChange }: { preference: ThemePreference; onChange: (next: ThemePreference) => void }) {
  return (
    <section className="settings-panel">
      <h2>显示</h2>
      <p className="muted">白天、夜间，或跟着系统切换。</p>
      <div className="theme-switch" role="group" aria-label="显示模式">
        {themeOptions.map((item) => (
          <button
            key={item.id}
            type="button"
            className={preference === item.id ? 'primary' : 'settings-secondary'}
            aria-pressed={preference === item.id}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function SharePanel() {
  const [share, setShare] = useState<ShareStatus | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void getShare().then(setShare).catch((reason: Error) => setError(reason.message))
  }, [])

  async function update(enabled: boolean, rotate = false) {
    setError('')
    setCopied(false)
    const next = await saveShare({ enabled, rotate })
    setShare(next)
  }

  const link = share?.path ? `${window.location.origin}${share.path}` : ''

  return (
    <section className="settings-panel">
      <h2>分享书架</h2>
      <p className="muted">打开后，知道链接的人可以查看你的书架和划线。可以随时关闭。</p>
      {share?.enabled && link ? (
        <div className="share-link">
          <input readOnly value={link} aria-label="分享链接" onFocus={(event) => event.currentTarget.select()} />
          <button
            type="button"
            className="settings-secondary"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setCopied(false))
            }}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      ) : null}
      <div className="settings-actions">
        <button type="button" id="share-toggle" className="primary" onClick={() => void update(!share?.enabled).catch((reason: Error) => setError(reason.message))}>
          {share?.enabled ? '关闭分享' : '生成分享链接'}
        </button>
        {share?.enabled ? (
          <button type="button" className="settings-secondary" onClick={() => void update(true, true).catch((reason: Error) => setError(reason.message))}>
            更换链接
          </button>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </section>
  )
}

function ShareShelf({ token }: { token: string }) {
  const [owner, setOwner] = useState('')
  const loadBooks = useCallback(async () => {
    const data = await getPublicShelf(token)
    setOwner(data.owner)
    return data
  }, [token])
  const bookPath = useCallback(
    (bookId: string) => `/s/${encodeURIComponent(token)}/book/${encodeURIComponent(bookId)}`,
    [token],
  )
  const externalPath = useCallback(
    (bookId: string) => `/api/public/shelves/${encodeURIComponent(token)}/books/${encodeURIComponent(bookId)}/weread-redirect`,
    [token],
  )

  return (
    <>
      <p className="share-kicker">{owner ? `${owner}的书架` : '分享的书架'}</p>
      <Shelf
        libraryVersion={0}
        syncing={false}
        loadBooks={loadBooks}
        bookPath={bookPath}
        externalPath={externalPath}
        emptyMessage="这套书架还没有书。"
      />
    </>
  )
}

function Settings({
  sync,
  libraryVersion,
  themePreference,
  onTheme,
  onSync,
  onBack,
  onOpenGuide,
}: {
  sync: SyncStatus | null
  libraryVersion: number
  themePreference: ThemePreference
  onTheme: (next: ThemePreference) => void
  onSync: (force: boolean) => Promise<void>
  onBack: () => void
  onOpenGuide: () => void
}) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [bookCount, setBookCount] = useState<number | null>(null)
  const [wrName, setWrName] = useState<string | null>(null)

  useEffect(() => {
    void getKeyStatus().then((status) => setConfigured(status.configured))
    void getMe().then((me) => setWrName(me.weread.wrName)).catch(() => setWrName(null))
  }, [libraryVersion])

  useEffect(() => {
    void getBooks()
      .then((data) => setBookCount(data.books.length))
      .catch(() => setBookCount(null))
  }, [libraryVersion])

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

  const last = sync?.last

  return (
    <div className="settings-page">
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

      <header className="settings-head">
        <h1>设置</h1>
        <p className="muted">
          {configured ? '账号、微信读书和同步都在这里。' : '先连上微信读书，再同步书架。'}
        </p>
      </header>

      <WereadBind
        configured={configured}
        wrName={wrName}
        bookCount={bookCount}
        syncing={sync?.running === true}
        onSync={() => void onSync(false)}
        onChange={() => {
          void getKeyStatus().then((status) => setConfigured(status.configured))
          void getMe().then((me) => setWrName(me.weread.wrName)).catch(() => setWrName(null))
        }}
      />

      <ThemePanel preference={themePreference} onChange={onTheme} />

      <section className="settings-panel">
        <h2>我的书架</h2>
        {bookCount != null ? (
          <>
            <p className="settings-stat">{bookCount.toLocaleString('zh-CN')}</p>
            <p className="settings-stat-label">本书在架上</p>
          </>
        ) : (
          <p className="muted">正在读取书架…</p>
        )}
        {bookCount === 0 ? (
          <p className="settings-lede">同步完成后，数字会变成你的在架本数。</p>
        ) : null}
        <div className="settings-sync">
          <h2>同步</h2>
          <p className="muted settings-meta">{autoSyncLine(sync)}</p>
          <div className="settings-actions">
            <button type="button" className="primary" onClick={() => void onSync(false)} disabled={sync?.running}>
              {sync?.running ? '同步中…' : '立即更新'}
            </button>
            <button type="button" className="settings-secondary" onClick={() => void onSync(true)} disabled={sync?.running}>
              强制同步
            </button>
          </div>
          {sync?.running && sync.recent?.[0] ? (
            <p className="muted settings-meta">
              {sync.recent[0].outcome === 'failed' ? '最近失败' : '刚刚更新'}：《{sync.recent[0].title || '未命名'}》
            </p>
          ) : null}
          {sync?.running && sync.total > 0 ? (
            <p className="muted settings-meta">进度 {sync.done} / {sync.total}</p>
          ) : null}
          {last ? (
            <p className="muted settings-meta">
              上次同步：书架 {last.shelfCount} 本，更新 {last.updated}，跳过 {last.skipped}
              {last.failed > 0 ? `，失败 ${last.failed}` : ''}
            </p>
          ) : (
            <p className="muted settings-meta">还没有同步记录。</p>
          )}
        </div>
      </section>

      <form className="settings-panel settings-form" onSubmit={(event) => void onSubmit(event)}>
        <details>
          <summary>高级：手动填写 API Key</summary>
          <p className="muted">
            {configured ? '已绑定。保存新的 Key 之前会先向微信读书确认。' : '扫码失败时可以粘贴 wrk- 开头的 Key。'}
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
        </details>
        {message ? <p>{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </form>

      <SharePanel />

      <section className="settings-panel">
        <h2>功能导览</h2>
        <p className="muted">了解书架、书页与惊喜模式的用法。</p>
        <button type="button" className="settings-secondary" onClick={onOpenGuide}>
          打开功能导览
        </button>
      </section>
    </div>
  )
}
