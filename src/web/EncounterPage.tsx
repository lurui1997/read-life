import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { getEncounter, getPublicEncounter } from './api'
import { encounterHref, encounterView, readingScope, sharedBookHref, type Encounter, type EncounterSection, type EncounterView, type ReadingScope } from '../shared/encounter'

const countKey = 'read-life.encounter-count'
const scopeKey = 'read-life.encounter-scope'
const viewKey = 'read-life.encounter-view'
const scopes: Array<{ id: ReadingScope; label: string }> = [
  { id: 'all', label: '所有书籍' },
  { id: 'finished', label: '已读完' },
  { id: 'reading', label: '进行中' },
]
const views: Array<{ id: EncounterView; label: string }> = [
  { id: 'flat', label: '随机' },
  { id: 'group', label: '分组' },
  { id: 'category', label: '分类' },
]
const countPresets = [3, 5, 10, 20]
const minCount = 1
const maxCount = 50

export function EncounterPage({
  libraryVersion,
  shareToken,
}: {
  libraryVersion: number
  shareToken?: string
}) {
  const [encounters, setEncounters] = useState<Encounter[] | null>(null)
  const [sections, setSections] = useState<EncounterSection[] | null>(null)
  const [open, setOpen] = useState<string[]>([])
  const [count, setCount] = useState(readCount)
  const [scope, setScope] = useState(readScope)
  const [view, setView] = useState(readView)
  const [custom, setCustom] = useState(() => !countPresets.includes(readCount()))
  const [draft, setDraft] = useState(() => String(readCount()))
  const [error, setError] = useState('')
  const ticket = useRef(0)
  const customInput = useRef<HTMLInputElement>(null)
  const focusCustom = useRef(false)

  const load = useCallback((exclude: string[], nextCount: number, nextScope: ReadingScope, nextView: EncounterView, scroll = false) => {
    const mine = ++ticket.current
    setError('')
    const request = shareToken
      ? getPublicEncounter(shareToken, exclude, nextCount, nextScope, nextView)
      : getEncounter(exclude, nextCount, nextScope, nextView)
    void request
      .then((next) => {
        if (mine !== ticket.current) return
        flushSync(() => {
          if ('sections' in next) {
            setEncounters(null)
            setSections(next.sections)
            setOpen((current) => current.filter((key) => next.sections.some((section) => section.key === key)))
          } else {
            setSections(null)
            setEncounters(next.encounters)
          }
        })
        if (scroll) window.scrollTo({ top: 0, behavior: 'auto' })
      })
      .catch((reason: Error) => {
        if (mine === ticket.current) setError(reason.message)
      })
  }, [shareToken])

  useEffect(() => {
    setEncounters(null)
    setSections(null)
    load([], count, scope, view)
  }, [libraryVersion, count, scope, view, load])

  useEffect(() => {
    setDraft(String(count))
  }, [count])

  useEffect(() => {
    if (!custom || !focusCustom.current) return
    focusCustom.current = false
    customInput.current?.focus()
    customInput.current?.select()
  }, [custom])

  const refresh = useCallback(() => {
    const shown = encounters ?? sections?.flatMap((section) => section.encounters) ?? []
    load(shown.map((item) => item.bookmarkId), count, scope, view, true)
  }, [count, encounters, load, scope, sections, view])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'r' && event.key !== 'R') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      refresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

  function changeCount(next: number) {
    const clamped = Math.min(maxCount, Math.max(minCount, next))
    setCount(clamped)
    try {
      localStorage.setItem(countKey, String(clamped))
    } catch {
      // 浏览器拒绝存储时，这次页面里的条数仍然有效
    }
  }

  function chooseCount(value: string) {
    if (value === 'custom') {
      focusCustom.current = true
      setCustom(true)
      return
    }
    setCustom(false)
    changeCount(Number(value))
  }

  function commitDraft() {
    const next = Number(draft)
    if (!Number.isInteger(next)) {
      setDraft(String(count))
      return
    }
    changeCount(next)
  }

  function chooseScope(next: ReadingScope) {
    setScope(next)
    try {
      localStorage.setItem(scopeKey, next)
    } catch {
      // 写不进时，这次页面里的范围仍然有效
    }
  }

  function chooseView(next: EncounterView) {
    setView(next)
    try {
      localStorage.setItem(viewKey, next)
    } catch {
      // 写不进时，这次页面里的看法仍然有效
    }
  }

  function toggleSection(key: string) {
    setOpen((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }

  const waiting = encounters == null && sections == null && !error
  const flatEmpty = view === 'flat' && encounters?.length === 0
  const groupedEmpty = view !== 'flat' && sections?.length === 0

  return (
    <section className="encounter-page" aria-label="随机划线">
      <div className="encounter-scopes" role="group" aria-label="划线范围">
        {scopes.map((item) => (
          <button key={item.id} type="button" aria-pressed={scope === item.id} onClick={() => chooseScope(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="encounter-scopes encounter-facets" role="group" aria-label="聚合方式">
        {views.map((item) => (
          <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => chooseView(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {waiting ? <p className="state-message">正在抽出…</p> : null}
      {flatEmpty || groupedEmpty ? <p className="state-message">{emptyCopy(scope, view)}</p> : null}
      {view === 'flat' && encounters && encounters.length > 0 ? <EncounterList lines={encounters} shareToken={shareToken} /> : null}
      {view !== 'flat' && sections && sections.length > 0 ? (
        <div className="encounter-sections">
          {sections.map((section) => {
            const expanded = open.includes(section.key)
            return (
              <section key={section.key} className="encounter-section">
                <button type="button" className={expanded ? 'encounter-section-head open' : 'encounter-section-head'} aria-expanded={expanded} onClick={() => toggleSection(section.key)}>
                  <span>{section.label}</span>
                  <span className="section-count">{section.bookCount} 本 · {section.lineCount} 条</span>
                </button>
                {expanded && section.encounters.length > 0 ? <EncounterList lines={section.encounters} shareToken={shareToken} /> : null}
                {expanded && section.encounters.length === 0 ? <p className="state-message">这里还没有可以单独成句的划线。</p> : null}
              </section>
            )
          })}
        </div>
      ) : null}
      <div className="encounter-tools">
        <button type="button" className="encounter-refresh" aria-keyshortcuts="r" onClick={refresh}>
          重新随机
        </button>
        <label className="encounter-count">
          <select aria-label="每次条数" value={custom ? 'custom' : String(count)} onChange={(event) => chooseCount(event.target.value)}>
            {countPresets.map((preset) => (
              <option key={preset} value={preset}>{preset} 条</option>
            ))}
            <option value="custom">自定义</option>
          </select>
          {custom ? (
            <input
              ref={customInput}
              type="number"
              inputMode="numeric"
              min={minCount}
              max={maxCount}
              aria-label="自定义条数"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                commitDraft()
              }}
            />
          ) : null}
        </label>
      </div>
    </section>
  )
}

function EncounterList({ lines, shareToken }: { lines: Encounter[]; shareToken?: string }) {
  return (
    <ol className="encounter-list">
      {lines.map((encounter) => (
        <li key={encounter.bookmarkId}>
          <a
            className="encounter"
            href={shareToken ? sharedBookHref(shareToken, encounter.bookId, encounter.bookmarkId) : encounterHref(encounter.bookId, encounter.bookmarkId)}
            target="_blank"
            rel="noreferrer"
          >
            <p className="encounter-line">{encounter.markText}</p>
            <span className="encounter-meta">
              <span className="encounter-title">{encounter.title || '未命名'}</span>
              <span className="encounter-go">去这一章</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  )
}

function readView(): EncounterView {
  try {
    return encounterView(localStorage.getItem(viewKey))
  } catch {
    return 'flat'
  }
}

function readScope(): ReadingScope {
  try {
    return readingScope(localStorage.getItem(scopeKey))
  } catch {
    return 'all'
  }
}

function emptyCopy(scope: ReadingScope, view: EncounterView): string {
  const where = scope === 'finished' ? '已读完的书里，' : scope === 'reading' ? '进行中的书里，' : ''
  if (view === 'group') return `${where}还没有可以按分组单独成句的划线。`
  if (view === 'category') return `${where}还没有可以按分类单独成句的划线。`
  if (where) return `${where}还没有可以单独成句的划线。`
  return '还没有可以单独成句的划线。'
}

function readCount(): number {
  try {
    const count = Number(localStorage.getItem(countKey))
    if (Number.isInteger(count) && count >= minCount && count <= maxCount) return count
  } catch {
    // 读不到时用默认三条
  }
  return 3
}
