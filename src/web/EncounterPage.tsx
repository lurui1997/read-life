import { useEffect, useState } from 'react'
import { getEncounter } from './api'
import { encounterHref, type Encounter } from '../shared/encounter'

export function EncounterPage({
  libraryVersion,
  onOpen,
}: {
  libraryVersion: number
  onOpen: (href: string) => void
}) {
  const [encounters, setEncounters] = useState<Encounter[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stop = false
    setError('')
    setEncounters(null)
    void getEncounter()
      .then((next) => {
        if (!stop) setEncounters(next.encounters)
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message)
      })
    return () => {
      stop = true
    }
  }, [libraryVersion])

  function refresh() {
    const current = encounters ?? []
    setError('')
    void getEncounter(current.map((item) => item.bookmarkId))
      .then((next) => setEncounters(next.encounters))
      .catch((reason: Error) => setError(reason.message))
  }

  return (
    <section className="encounter-page" aria-label="随机划线">
      <header className="encounter-head">
        <h1>随机划线</h1>
        <p className="muted">从很久没翻开的书里抽出三句。</p>
      </header>
      {error ? <p className="error">{error}</p> : null}
      {encounters == null && !error ? <p className="state-message">正在抽出三句…</p> : null}
      {encounters?.length === 0 ? <p className="state-message">还没有可以单独成句的划线。</p> : null}
      {encounters && encounters.length > 0 ? (
        <>
          <ol className="encounter-list">
            {encounters.map((encounter) => (
              <li key={encounter.bookmarkId}>
                <a
                  className="encounter"
                  href={encounterHref(encounter.bookId, encounter.bookmarkId)}
                  onClick={(event) => {
                    event.preventDefault()
                    onOpen(encounterHref(encounter.bookId, encounter.bookmarkId))
                  }}
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
          <button type="button" className="encounter-refresh" onClick={refresh}>
            重新随机
          </button>
        </>
      ) : null}
    </section>
  )
}
