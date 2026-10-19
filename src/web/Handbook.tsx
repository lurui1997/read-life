import { useEffect, useRef, useState } from 'react'
import { HANDBOOK_BOOK_LIMIT } from '../shared/handbook'
import {
  createHandbook,
  deleteHandbook,
  drawHandbookChapter,
  getHandbook,
  rewriteHandbookChapter,
  saveHandbookChapter,
  searchHandbookBooks,
  writeHandbook,
  type HandbookShelfBook,
  type HandbookView,
} from './api'

export function Handbook() {
  const [view, setView] = useState<HandbookView | null>(null)
  const [position, setPosition] = useState(1)
  const [draft, setDraft] = useState<{ position: number; title: string; body: string } | null>(null)
  const [error, setError] = useState('')
  const [imageTick, setImageTick] = useState(0)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<HandbookShelfBook[]>([])
  const [picked, setPicked] = useState<HandbookShelfBook[]>([])
  const [handbookId, setHandbookId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const wasRunning = useRef(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const focusSearch = useRef(false)
  const seenHandbook = useRef<string | null>(null)

  useEffect(() => {
    let stop = false
    async function load() {
      try {
        const next = await getHandbook(handbookId)
        if (stop) return
        if (wasRunning.current && !next.job.running) {
          setImageTick((tick) => tick + 1)
          setDraft(null)
        }
        wasRunning.current = next.job.running
        setView(next)
        setError(next.job.error ?? '')
      } catch (cause) {
        if (!stop) setError(cause instanceof Error ? cause.message : '手册没有打开')
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 1000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [handbookId])

  useEffect(() => {
    const text = query.trim()
    if (!text) {
      setMatches([])
      return
    }
    let stop = false
    const timer = window.setTimeout(() => {
      void searchHandbookBooks(text).then((result) => {
        if (!stop) setMatches(result.books)
      }).catch(() => {
        if (!stop) setMatches([])
      })
    }, 200)
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [query])

  const chapter = view?.chapters.find((item) => item.position === position) ?? null
  const showing = chapter && draft?.position === chapter.position ? draft : chapter
  const title = showing?.title ?? ''
  const body = showing?.body ?? ''
  const running = view?.job.running === true
  const written = (view?.chapters ?? []).some((item) => item.title.trim() || item.body.trim())
  const showComposer = composing || !written

  useEffect(() => {
    const id = view?.handbookId ?? null
    if (seenHandbook.current === id) return
    seenHandbook.current = id
    setComposing(false)
    setPendingDelete(null)
  }, [view?.handbookId])

  useEffect(() => {
    if (!focusSearch.current || !showComposer) return
    focusSearch.current = false
    searchInput.current?.focus()
  }, [showComposer])

  useEffect(() => {
    for (const element of [titleRef.current, bodyRef.current]) {
      if (!element) continue
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight}px`
    }
  }, [title, body, position, view?.handbookId])

  function edit(next: { title?: string; body?: string }) {
    if (!chapter) return
    setDraft({
      position: chapter.position,
      title: next.title ?? title,
      body: next.body ?? body,
    })
  }

  async function persist() {
    if (!chapter || !draft || draft.position !== chapter.position) return
    if (draft.title.trim() === chapter.title && draft.body.trim() === chapter.body) return
    if (!draft.title.trim() && !draft.body.trim()) {
      if (chapter.title.trim() || chapter.body.trim()) setError('章名和正文不能为空')
      return
    }
    try {
      if (!view?.handbookId) return
      const next = await saveHandbookChapter(position, draft.title.trim(), draft.body.trim(), view.handbookId)
      setDraft(null)
      setView(next)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '这一章没有保存')
    }
  }

  async function remove(item: { id: string; title: string }) {
    const current = view?.handbookId ?? null
    if (current && current !== item.id) await persist()
    try {
      const next = await deleteHandbook(item.id, current === item.id ? null : current)
      setDraft(null)
      if (current === item.id) setPosition(1)
      setPendingDelete(null)
      setHandbookId(next.handbookId)
      setView(next)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '这本手册没有删掉')
    }
  }

  async function run(action: () => Promise<HandbookView>) {
    setError('')
    try {
      const next = await action()
      setHandbookId(next.handbookId)
      setView(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '手册没有开始')
    }
  }

  return (
    <section className="handbook">
      <nav className="handbook-toc" aria-label="七章">
        {Array.from({ length: 7 }, (_, index) => {
          const item = view?.chapters.find((chapter) => chapter.position === index + 1)
          return (
            <button
              key={index + 1}
              type="button"
              aria-current={position === index + 1 ? 'true' : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                void persist().then(() => setPosition(index + 1))
              }}
            >
              <span>{index + 1}</span>
              <span className="handbook-toc-title">{item?.title || '尚未写'}</span>
            </button>
          )
        })}
      </nav>
      <div className="handbook-stage">
        <div className="handbook-bar">
          {view && view.history.length > 0 ? (
            <div className="handbook-history">
              <label>
                <span className="sr-only">历史手册</span>
                <select
                  aria-label="历史手册"
                  value={view.handbookId ?? ''}
                  disabled={running}
                  onChange={(event) => {
                    const id = event.target.value
                    setPendingDelete(null)
                    void persist().then(() => setHandbookId(id))
                  }}
                >
                  {view.history.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatHandbookTime(item.createdAt)} {item.title || '未命名'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : <span />}
          <div className="handbook-bar-actions">
            {view?.handbookId ? (
              pendingDelete === view.handbookId ? (
                <span className="handbook-confirm">
                  <button type="button" className="handbook-danger" disabled={running} onClick={() => {
                    const item = view.history.find((entry) => entry.id === pendingDelete)
                    if (item) void remove(item)
                  }}>确认删除</button>
                  <button type="button" onClick={() => setPendingDelete(null)}>取消</button>
                </span>
              ) : (
                <button type="button" aria-label="删除这本手册" disabled={running} onClick={() => setPendingDelete(view.handbookId)}>
                  删除
                </button>
              )
            ) : null}
            <button type="button" disabled={running || !chapter || !view?.handbookId} onClick={() => void run(() => rewriteHandbookChapter(position, view?.handbookId ?? ''))}>
              重写这一章
            </button>
            <button type="button" disabled={running || !chapter || !view?.handbookId} onClick={() => void run(() => drawHandbookChapter(position, view?.handbookId ?? ''))}>
              {chapter?.hasImage ? '重画' : '画这一章'}
            </button>
            {written ? (
              <button
                type="button"
                aria-expanded={showComposer}
                onClick={() => {
                  if (showComposer) {
                    setComposing(false)
                    return
                  }
                  focusSearch.current = true
                  setComposing(true)
                }}
              >
                {showComposer ? '收起' : '按书重写'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={running}
              onClick={() => void run(async () => {
                setPosition(1)
                setDraft(null)
                return createHandbook()
              })}
            >
              新建手册
            </button>
          </div>
        </div>
        {showComposer ? (
          <div className="handbook-composer">
            <p>每次最多选 {HANDBOOK_BOOK_LIMIT} 本书，只读这几本。</p>
            <div className="handbook-pick">
              <input
                ref={searchInput}
                aria-label="选择书"
                placeholder="搜索书名或作者…"
                value={query}
                disabled={running}
                onChange={(event) => setQuery(event.target.value)}
              />
              {picked.length > 0 ? (
                <ul className="handbook-picked">
                  {picked.map((book) => (
                    <li key={book.bookId}>
                      <span>《{book.title}》</span>
                      <button
                        type="button"
                        disabled={running}
                        onClick={() => setPicked((current) => current.filter((item) => item.bookId !== book.bookId))}
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {matches.length > 0 ? (
                <ul className="handbook-matches">
                  {matches.map((book) => {
                    const selected = picked.some((item) => item.bookId === book.bookId)
                    const full = picked.length >= HANDBOOK_BOOK_LIMIT && !selected
                    return (
                      <li key={book.bookId}>
                        <button
                          type="button"
                          disabled={running || selected || full}
                          onClick={() => setPicked((current) => current.length >= HANDBOOK_BOOK_LIMIT ? current : [...current, book])}
                        >
                          《{book.title}》 {book.author}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
            <div className="handbook-actions">
              <button type="button" className="handbook-commit" disabled={running || picked.length === 0} onClick={() => void run(() => writeHandbook(picked.map((book) => book.bookId), false))}>
                {written ? '重写整本' : '写手册'}
              </button>
              <button type="button" disabled={running || picked.length === 0} onClick={() => void run(() => writeHandbook(picked.map((book) => book.bookId), true))}>
                连卡片一起重做
              </button>
            </div>
          </div>
        ) : null}
        {view?.job.running ? <p className="handbook-progress">{view.job.message} {view.job.total > 0 ? `${view.job.done}/${view.job.total}` : ''}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {view && !view.modelReady ? <p className="handbook-note">生成需要本机已登录的 Cursor CLI（agent）。已经写好的章节仍可以阅读和修改。</p> : null}
        {chapter ? (
          <div className="handbook-reading">
            {chapter.hasImage ? (
              <img
                className="handbook-plate"
                alt=""
                src={`/api/handbook/chapters/${chapter.position}/image?handbook=${encodeURIComponent(view?.handbookId ?? '')}&v=${imageTick}`}
              />
            ) : null}
            <textarea
              ref={titleRef}
              className="handbook-title"
              aria-label="章名"
              rows={1}
              placeholder="章名"
              value={title}
              disabled={running}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault()
              }}
              onChange={(event) => {
                const next = event.target.value.replace(/\n/g, '')
                edit({ title: next })
                event.target.style.height = 'auto'
                event.target.style.height = `${event.target.scrollHeight}px`
              }}
              onBlur={() => void persist()}
            />
            <textarea
              ref={bodyRef}
              className="handbook-body"
              aria-label="正文"
              placeholder="这一章写什么"
              value={body}
              disabled={running}
              onChange={(event) => {
                edit({ body: event.target.value })
                event.target.style.height = 'auto'
                event.target.style.height = `${event.target.scrollHeight}px`
              }}
              onBlur={() => void persist()}
            />
            {chapter.books.length > 0 ? (
              <ul className="handbook-books">
                {chapter.books.map((book) => (
                  <li key={book.bookId}>
                    <p>《{book.title}》 {book.author}</p>
                    {book.quotes.map((quote) => <blockquote key={quote}>{quote}</blockquote>)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="handbook-empty">
            <h1>人生手册</h1>
            <p>一次读一章。每次最多选 3 本书，只读这几本。</p>
          </div>
        )}
      </div>
    </section>
  )
}

function formatHandbookTime(value: string) {
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16)
  return parsed.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
