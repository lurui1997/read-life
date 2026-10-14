import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { getEncounter, getPublicEncounter } from './api'
import { encounterHref, sharedBookHref, type Encounter } from '../shared/encounter'

const countKey = 'read-life.encounter-count'
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
  const [count, setCount] = useState(readCount)
  const [custom, setCustom] = useState(() => !countPresets.includes(readCount()))
  const [draft, setDraft] = useState(() => String(readCount()))
  const [error, setError] = useState('')
  const ticket = useRef(0)
  const customInput = useRef<HTMLInputElement>(null)
  const focusCustom = useRef(false)

  const load = useCallback((exclude: string[], nextCount: number, scroll = false) => {
    const mine = ++ticket.current
    setError('')
    const request = shareToken ? getPublicEncounter(shareToken, exclude, nextCount) : getEncounter(exclude, nextCount)
    void request
      .then((next) => {
        if (mine !== ticket.current) return
        flushSync(() => setEncounters(next.encounters))
        if (scroll) window.scrollTo({ top: 0, behavior: 'auto' })
      })
      .catch((reason: Error) => {
        if (mine === ticket.current) setError(reason.message)
      })
  }, [shareToken])

  useEffect(() => {
    load([], count)
  }, [libraryVersion, count, load])

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
    load((encounters ?? []).map((item) => item.bookmarkId), count, true)
  }, [count, encounters, load])

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

  return (
    <section className="encounter-page" aria-label="随机划线">
      {error ? <p className="error">{error}</p> : null}
      {encounters == null && !error ? <p className="state-message">正在抽出…</p> : null}
      {encounters?.length === 0 ? <p className="state-message">还没有可以单独成句的划线。</p> : null}
      {encounters && encounters.length > 0 ? (
        <ol className="encounter-list">
          {encounters.map((encounter) => (
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

function readCount(): number {
  try {
    const count = Number(localStorage.getItem(countKey))
    if (Number.isInteger(count) && count >= minCount && count <= maxCount) return count
  } catch {
    // 读不到时用默认三条
  }
  return 3
}
