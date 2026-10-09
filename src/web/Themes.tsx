import { useEffect, useState } from 'react'
import { clusterThemes, getThemeBoard, getThemeHighlights, getThemeScopes, mergeThemes, moveThemeHighlight, renameTheme } from './api'
import type { ScopeKind, ThemeBoard, ThemeHighlightLine, ThemeScopeOption } from '../shared/themes'

type Scopes = {
  categories: ThemeScopeOption[]
  groups: ThemeScopeOption[]
  recent: ThemeScopeOption
}

export function Themes({ onOpen }: { onOpen: (href: string) => void }) {
  const [scopes, setScopes] = useState<Scopes | null>(null)
  const [kind, setKind] = useState<ScopeKind>('category')
  const [key, setKey] = useState('')
  const [board, setBoard] = useState<ThemeBoard | null>(null)
  const [active, setActive] = useState('')
  const [lines, setLines] = useState<ThemeHighlightLine[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stop = false
    void getThemeScopes().then((next) => {
      if (stop) return
      setScopes(next)
      const first = next.categories[0]
      if (first) {
        setKind('category')
        setKey(first.key)
      } else if (next.groups[0]) {
        setKind('group')
        setKey(next.groups[0].key)
      } else {
        setKind('recent')
        setKey(next.recent.key)
      }
    }).catch((reason: unknown) => {
      if (!stop) setError(reason instanceof Error ? reason.message : '主题没有载入')
    })
    return () => {
      stop = true
    }
  }, [])

  useEffect(() => {
    if (!key) return
    let stop = false
    setBoard(null)
    setLines([])
    setActive('')
    void getThemeBoard(kind, key).then((next) => {
      if (stop) return
      setBoard(next)
      if (next.clustered) setActive(next.themes[0]?.id ?? (next.unassignedCount > 0 ? 'unassigned' : ''))
    }).catch((reason: unknown) => {
      if (!stop) setError(reason instanceof Error ? reason.message : '这个范围没有载入')
    })
    return () => {
      stop = true
    }
  }, [kind, key])

  useEffect(() => {
    if (!board?.clustered || !active) {
      setLines([])
      return
    }
    let stop = false
    void getThemeHighlights(kind, key, active).then((next) => {
      if (!stop) setLines(next.highlights)
    }).catch((reason: unknown) => {
      if (!stop) setError(reason instanceof Error ? reason.message : '划线没有载入')
    })
    return () => {
      stop = true
    }
  }, [board?.clustered, kind, key, active])

  const options = kind === 'category' ? scopes?.categories ?? [] : kind === 'group' ? scopes?.groups ?? [] : scopes ? [scopes.recent] : []

  async function runCluster() {
    if (!board) return
    if (board.clustered && !window.confirm('重新归纳会丢掉这个范围里现有的主题、改名和挪动。继续吗？')) return
    setBusy(true)
    setError('')
    try {
      const next = await clusterThemes(kind, key)
      setBoard(next)
      setActive(next.themes[0]?.id ?? (next.unassignedCount > 0 ? 'unassigned' : ''))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '归纳没有完成')
    } finally {
      setBusy(false)
    }
  }

  async function refresh(nextActive = active) {
    const next = await getThemeBoard(kind, key)
    setBoard(next)
    const stillThere = nextActive === 'unassigned'
      ? next.unassignedCount > 0
      : next.themes.some((theme) => theme.id === nextActive)
    setActive(stillThere ? nextActive : (next.themes[0]?.id ?? (next.unassignedCount > 0 ? 'unassigned' : '')))
  }

  async function onRename(themeId: string, name: string) {
    setError('')
    try {
      await renameTheme(themeId, name)
      await refresh(themeId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '没有改成')
    }
  }

  async function onMerge(sourceId: string, targetId: string) {
    setError('')
    try {
      await mergeThemes(sourceId, targetId)
      await refresh(targetId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '没有并成')
    }
  }

  async function onMove(bookmarkId: string, themeId: string) {
    setError('')
    try {
      const next = await moveThemeHighlight({
        kind,
        key,
        bookmarkId,
        themeId: themeId === 'new' || themeId === 'out' ? null : themeId,
        create: themeId === 'new',
      })
      setBoard(next)
      const stay = themeId === 'out' || themeId === 'new'
        ? (themeId === 'out' ? 'unassigned' : next.themes.find((theme) => !board?.themes.some((old) => old.id === theme.id))?.id ?? active)
        : themeId
      setActive(stay || next.themes[0]?.id || '')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '没有挪成')
    }
  }

  return (
    <section className="themes-page">
      <header className="themes-head">
        <h1>主题</h1>
        <p>先圈一个范围。相近的划线会收成一堆，你可以改名、合并、挪句子。</p>
      </header>
      {error ? <p className="error">{error}</p> : null}
      <div className="themes-kinds" role="tablist" aria-label="范围种类">
        {([['category', '分类'], ['group', '分组'], ['recent', '最近读过']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={kind === value ? 'themes-kind active' : 'themes-kind'}
            data-kind={value}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value)
              const next = value === 'category' ? scopes?.categories[0] : value === 'group' ? scopes?.groups[0] : scopes?.recent
              setKey(next?.key ?? '')
              setBoard(null)
              setLines([])
              setActive('')
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {!scopes ? <p className="state-message">正在读取范围。</p> : null}
      {scopes && options.length === 0 ? <p className="state-message">这个范围里还没有划线。</p> : null}
      {scopes && options.length > 0 ? (
        <div className="themes-layout">
          <div className="themes-scopes" role="listbox" aria-label="范围">
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                className={option.key === key ? 'themes-scope active' : 'themes-scope'}
                data-scope={option.key}
                onClick={() => {
                setKey(option.key)
                setBoard(null)
                setLines([])
                setActive('')
              }}
              >
                <span>{option.label}</span>
                <span className="themes-scope-meta">{option.bookCount} 本 · {option.highlightCount} 条</span>
              </button>
            ))}
          </div>
          <div className="themes-board">
            {!board ? <p className="state-message">正在读取这个范围。</p> : null}
            {board && !board.clustered ? (
              <div className="themes-empty">
                <p className="settings-stat">{board.highlightCount}</p>
                <p className="settings-stat-label">{board.bookCount} 本书里的划线，还没有归纳。</p>
                <button type="button" className="primary" data-action="cluster" disabled={busy || board.highlightCount === 0} onClick={() => void runCluster()}>
                  {busy ? '正在归纳' : '归纳'}
                </button>
              </div>
            ) : null}
            {board?.clustered ? (
              <>
                <div className="themes-actions">
                  <button type="button" className="settings-secondary" disabled={busy} onClick={() => void runCluster()}>
                    {busy ? '正在归纳' : '重新归纳'}
                  </button>
                </div>
                <div className="themes-piles">
                  {board.themes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className={active === theme.id ? 'themes-pile active' : 'themes-pile'}
                      onClick={() => setActive(theme.id)}
                    >
                      <span>{theme.name}</span>
                      <span className="themes-scope-meta">{theme.count} 条</span>
                    </button>
                  ))}
                  {board.unassignedCount > 0 ? (
                    <button
                      type="button"
                      className={active === 'unassigned' ? 'themes-pile active' : 'themes-pile'}
                      onClick={() => setActive('unassigned')}
                    >
                      <span>尚未归入</span>
                      <span className="themes-scope-meta">{board.unassignedCount} 条</span>
                    </button>
                  ) : null}
                </div>
                {active && active !== 'unassigned' ? (
                  <ThemeEditor
                    name={board.themes.find((theme) => theme.id === active)?.name ?? ''}
                    others={board.themes.filter((theme) => theme.id !== active)}
                    onRename={(name) => void onRename(active, name)}
                    onMerge={(targetId) => void onMerge(active, targetId)}
                  />
                ) : null}
                <ul className="themes-lines">
                  {lines.map((line) => (
                    <li key={line.bookmarkId}>
                      <blockquote>{line.markText}</blockquote>
                      <p>
                        <a href={`/book/${encodeURIComponent(line.bookId)}`} onClick={(event) => { event.preventDefault(); onOpen(`/book/${encodeURIComponent(line.bookId)}`) }}>
                          {line.title}
                        </a>
                        {line.chapterTitle ? <span> · {line.chapterTitle}</span> : null}
                      </p>
                      <label>
                        挪到
                        <select value="" onChange={(event) => { if (event.target.value) void onMove(line.bookmarkId, event.target.value) }}>
                          <option value="">选择</option>
                          {board.themes.filter((theme) => theme.id !== active).map((theme) => (
                            <option key={theme.id} value={theme.id}>{theme.name}</option>
                          ))}
                          <option value="new">新建主题</option>
                          {active !== 'unassigned' ? <option value="out">挪出</option> : null}
                        </select>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ThemeEditor({
  name,
  others,
  onRename,
  onMerge,
}: {
  name: string
  others: Array<{ id: string; name: string }>
  onRename: (name: string) => void
  onMerge: (targetId: string) => void
}) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  return (
    <form
      className="themes-editor"
      onSubmit={(event) => {
        event.preventDefault()
        if (draft.trim() && draft.trim() !== name) onRename(draft)
      }}
    >
      <input aria-label="主题名" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit" className="settings-secondary">改名</button>
      {others.length > 0 ? (
        <label>
          并入
          <select value="" onChange={(event) => { if (event.target.value) onMerge(event.target.value) }}>
            <option value="">选择</option>
            {others.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </select>
        </label>
      ) : null}
    </form>
  )
}
