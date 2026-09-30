import { useEffect, useMemo, useRef, useState } from 'react'
import { encounterHref } from '../shared/encounter'
import {
  booksForPeak,
  buildPeaks,
  buildTerrain,
  filterBooksByMonth,
  formatMonth,
  listMonths,
  pickMapHit,
  placeMapLabels,
  projectMapPoint,
  terrainHeight,
  type MapCamera,
  type MapLabelHit,
  type MapPeak,
  type MapPointHit,
  type MapQuote,
  type MapSourceBook,
  type Terrain,
} from '../shared/reading-map'
import { getMap, getMapQuotes } from './api'

const HOME_YAW = -0.35
const OBLIQUE_PITCH = 0.74
const FLAT_PITCH = 0.08
const HEIGHT_SCALE = 0.38

type ReadingMapProps = {
  onClose: () => void
  onOpen: (href: string) => void
}

export function ReadingMap({ onClose, onOpen }: ReadingMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camera = useRef({ yaw: HOME_YAW, pitch: OBLIQUE_PITCH, targetPitch: OBLIQUE_PITCH, zoom: 1 })
  const drag = useRef<{ x: number; y: number; yaw: number; moved: boolean } | null>(null)
  const hits = useRef<{ points: MapPointHit[]; labels: MapLabelHit[] }>({ points: [], labels: [] })
  const scene = useRef<{ peaks: MapPeak[]; terrain: Terrain; selectedId: string | null }>({
    peaks: [],
    terrain: { contours: [], dust: [], maxHeight: 0 },
    selectedId: null,
  })
  const [books, setBooks] = useState<MapSourceBook[] | null>(null)
  const [error, setError] = useState('')
  const [month, setMonth] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [flat, setFlat] = useState(false)
  const [zoomPct, setZoomPct] = useState(100)
  const [yaw, setYaw] = useState(HOME_YAW)
  const [grabbing, setGrabbing] = useState(false)
  const [pointing, setPointing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quotes, setQuotes] = useState<MapQuote[] | null>(null)

  const months = useMemo(() => (books ? listMonths(books) : []), [books])
  const peaks = useMemo(
    () => (books ? buildPeaks(filterBooksByMonth(books, month)) : []),
    [books, month],
  )
  const terrain = useMemo(() => buildTerrain(peaks), [peaks])
  const selected = peaks.find((peak) => peak.id === selectedId) ?? null
  const selectedBooks = selected && books ? booksForPeak(books, selected, month).slice(0, 8) : []

  scene.current = { peaks, terrain, selectedId }

  useEffect(() => {
    let stop = false
    void getMap()
      .then((response) => {
        if (!stop) setBooks(response.books)
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message)
      })
    return () => {
      stop = true
    }
  }, [])

  useEffect(() => {
    if (selectedId && !peaks.some((peak) => peak.id === selectedId)) setSelectedId(null)
  }, [peaks, selectedId])

  useEffect(() => {
    if (!selected || selected.categories.length !== 1) {
      setQuotes(selected ? [] : null)
      return
    }
    const category = selected.categories[0]
    let stop = false
    setQuotes(null)
    void getMapQuotes(category)
      .then((response) => {
        if (!stop) setQuotes(response.quotes)
      })
      .catch(() => {
        if (!stop) setQuotes([])
      })
    return () => {
      stop = true
    }
  }, [selected])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setMonth((current) => {
        const index = months.findIndex((item) => item.id === current)
        const next = months[index + 1]
        if (!next) {
          setPlaying(false)
          return months.at(-1)?.id ?? null
        }
        return next.id
      })
    }, 900)
    return () => window.clearInterval(timer)
  }, [playing, months])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selectedId) setSelectedId(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, selectedId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const apply = () => {
      const rect = parent.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let alive = true
    const draw = () => {
      if (!alive) return
      const cam = camera.current
      if (reduced) cam.pitch = cam.targetPitch
      else cam.pitch += (cam.targetPitch - cam.pitch) * 0.16
      paintMap(canvas, cam, scene.current, hits.current)
      frame = window.requestAnimationFrame(draw)
    }
    frame = window.requestAnimationFrame(draw)
    return () => {
      alive = false
      window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom(camera.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  function setZoom(next: number) {
    const zoom = Math.min(2.4, Math.max(0.55, next))
    camera.current.zoom = zoom
    setZoomPct(Math.round(zoom * 100))
  }

  function toggleFlat() {
    const next = !flat
    setFlat(next)
    camera.current.targetPitch = next ? FLAT_PITCH : OBLIQUE_PITCH
  }

  function resetYaw() {
    camera.current.yaw = HOME_YAW
    setYaw(HOME_YAW)
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false)
      return
    }
    setMonth((current) => current ?? months[0]?.id ?? null)
    setPlaying(true)
  }

  function chooseMonth(next: string | null) {
    setPlaying(false)
    setMonth(next)
  }

  async function share() {
    const canvas = canvasRef.current
    if (!canvas) return
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `阅读地图-${month ? formatMonth(month) : '全部'}.png`
    link.click()
    URL.revokeObjectURL(url)
  }

  const sliderMax = Math.max(months.length, 1)
  const sliderValue = month == null ? months.length : Math.max(0, months.findIndex((item) => item.id === month))
  const monthLabel = month ? formatMonth(month) : '全部'

  return (
    <div className="reading-map">
      <canvas
        ref={canvasRef}
        className={grabbing ? 'map-canvas grabbing' : pointing ? 'map-canvas pointing' : 'map-canvas'}
        aria-label="阅读地图"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, yaw: camera.current.yaw, moved: false }
          setGrabbing(true)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const x = event.clientX - rect.left
          const y = event.clientY - rect.top
          const current = drag.current
          if (!current) {
            const over = pickMapHit(x, y, hits.current.points, hits.current.labels) != null
            setPointing((value) => value === over ? value : over)
            return
          }
          const dx = event.clientX - current.x
          if (Math.hypot(dx, event.clientY - current.y) > 4) current.moved = true
          camera.current.yaw = current.yaw + dx * 0.005
          setYaw(camera.current.yaw)
        }}
        onPointerUp={(event) => {
          const current = drag.current
          drag.current = null
          setGrabbing(false)
          if (!current || current.moved) return
          const rect = event.currentTarget.getBoundingClientRect()
          const x = event.clientX - rect.left
          const y = event.clientY - rect.top
          setSelectedId(pickMapHit(x, y, hits.current.points, hits.current.labels))
        }}
        onPointerCancel={() => {
          drag.current = null
          setGrabbing(false)
        }}
      />

      <ul className="map-a11y">
        {peaks.map((peak) => (
          <li key={peak.id}>
            <button type="button" className="map-a11y-peak" onClick={() => setSelectedId(peak.id)}>
              {peak.label}
            </button>
          </li>
        ))}
      </ul>

      <button type="button" className="map-close" aria-label="关闭地图" onClick={onClose}>
        <CloseIcon />
      </button>

      <div className="map-rail">
        <div className="map-zoom">
          <button type="button" aria-label="放大" onClick={() => setZoom(camera.current.zoom * 1.12)}>+</button>
          <span className="map-zoom-pct">{zoomPct}%</span>
          <button type="button" aria-label="缩小" onClick={() => setZoom(camera.current.zoom / 1.12)}>−</button>
        </div>
        <button type="button" className={flat ? 'map-flat on' : 'map-flat'} aria-pressed={flat} onClick={toggleFlat}>
          2D
        </button>
        <input
          className="map-zoom-range"
          type="range"
          min={55}
          max={240}
          value={zoomPct}
          aria-label="缩放"
          onChange={(event) => setZoom(Number(event.target.value) / 100)}
        />
        <button type="button" className="map-compass" aria-label="复位朝向" onClick={resetYaw}>
          <span className="map-compass-rose" style={{ transform: `rotate(${-yaw}rad)` }} />
        </button>
      </div>

      {selected ? (
        <aside className="map-panel" aria-label={selected.label}>
          <div className="map-panel-head">
            <p className="map-panel-parent">{selected.parent}</p>
            <button type="button" className="map-panel-close" onClick={() => setSelectedId(null)} aria-label="关闭主题">
              <CloseIcon />
            </button>
          </div>
          <h2>{selected.label}</h2>
          <p className="map-panel-meta">{selected.bookCount} 本 · {selected.highlightCount.toLocaleString('zh-CN')} 条划线</p>
          {selected.categories.length === 1 && quotes == null ? <p className="map-panel-wait">正在翻划线…</p> : null}
          {selected.categories.length === 1 && quotes && quotes.length === 0 ? <p className="map-panel-wait">这个峰还没有划线。</p> : null}
          {selected.categories.length === 1 && quotes && quotes.length > 0 ? (
            <ul className="map-quotes">
              {quotes.map((quote) => (
                <li key={quote.bookmarkId}>
                  <button type="button" onClick={() => onOpen(encounterHref(quote.bookId, quote.bookmarkId))}>
                    <span className="map-quote-text">{quote.markText}</span>
                    <span className="map-quote-book">{quote.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {selectedBooks.length > 0 ? (
            <ul className="map-books">
              {selectedBooks.map((book) => (
                <li key={book.bookId}>
                  <button type="button" onClick={() => onOpen(`/book/${encodeURIComponent(book.bookId)}`)}>
                    <span>{book.title}</span>
                    <em>{book.highlightCount > 0 ? `${book.highlightCount} 条` : '在读'}</em>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      ) : null}

      <div className="map-dock">
        <div className="map-timeline">
          <button type="button" className="map-play" aria-label={playing ? '暂停' : '按月播放'} onClick={togglePlay} disabled={months.length === 0}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span className="map-footprint">记录足迹</span>
          <label className="map-month">
            <span className="sr-only">月份</span>
            <select value={month ?? ''} onChange={(event) => chooseMonth(event.target.value || null)}>
              <option value="">全部</option>
              {[...months].reverse().map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <input
            className="map-time-range"
            type="range"
            min={0}
            max={sliderMax}
            step={1}
            value={Math.min(sliderValue, sliderMax)}
            aria-label="时间"
            aria-valuetext={monthLabel}
            disabled={months.length === 0}
            onChange={(event) => {
              const index = Number(event.target.value)
              chooseMonth(index >= months.length ? null : months[index]?.id ?? null)
            }}
          />
        </div>
        <button type="button" className="map-share" onClick={() => void share()}>分享图</button>
      </div>
      <p className="map-note">
        {peaks.reduce((sum, peak) => sum + peak.bookCount, 0).toLocaleString('zh-CN')} 本 · 与书架同一批在架书
      </p>

      {error ? <p className="map-status">{error}</p> : null}
      {!error && books == null ? <p className="map-status">正在铺开阅读地图…</p> : null}
      {!error && books && peaks.length === 0 ? (
        <p className="map-status">
          {books.length === 0 ? '还没有分类。同步书架后，地图会从分类和划线里长出来。' : `${monthLabel}没有留下阅读足迹。`}
        </p>
      ) : null}
    </div>
  )
}

function paintMap(
  canvas: HTMLCanvasElement,
  camera: { yaw: number; pitch: number; zoom: number },
  scene: { peaks: MapPeak[]; terrain: Terrain; selectedId: string | null },
  hits: { points: MapPointHit[]; labels: MapLabelHit[] },
) {
  const context = canvas.getContext('2d')
  if (!context) return
  const width = canvas.clientWidth || canvas.width
  const height = canvas.clientHeight || canvas.height
  const dpr = canvas.width / width
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#121212'
  context.fillRect(0, 0, width, height)
  context.fillStyle = 'rgba(255,255,255,0.16)'
  for (let y = 14; y < height; y += 22) {
    for (let x = 14; x < width; x += 22) context.fillRect(x, y, 1.15, 1.15)
  }

  const view: MapCamera = { ...camera, width, height }
  const { peaks, terrain, selectedId } = scene
  if (peaks.length === 0) {
    hits.points = []
    hits.labels = []
    return
  }

  let cx = 0
  let cy = 0
  let weight = 0
  for (const peak of peaks) {
    cx += peak.x * peak.weight
    cy += peak.y * peak.weight
    weight += peak.weight
  }
  const center = projectMapPoint(cx / weight, cy / weight, 0, view)
  const glow = context.createRadialGradient(center.sx, center.sy, 10, center.sx, center.sy, Math.min(width, height) * 0.34)
  glow.addColorStop(0, 'rgba(255,255,255,0.05)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)

  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const contour of terrain.contours) {
    const shade = contour.level / terrain.maxHeight
    context.beginPath()
    context.strokeStyle = `rgba(232,232,232,${0.14 + shade * 0.7})`
    context.lineWidth = shade > 0.75 ? 1.2 : 1
    for (const [ax, ay, bx, by] of contour.segments) {
      const start = projectMapPoint(ax, ay, contour.level * HEIGHT_SCALE, view)
      const end = projectMapPoint(bx, by, contour.level * HEIGHT_SCALE, view)
      context.moveTo(start.sx, start.sy)
      context.lineTo(end.sx, end.sy)
    }
    context.stroke()
  }

  for (const speck of terrain.dust) {
    const point = projectMapPoint(speck.x, speck.y, speck.z * HEIGHT_SCALE, view)
    context.fillStyle = `rgba(255,255,255,${speck.alpha})`
    context.fillRect(point.sx, point.sy, 1.25, 1.25)
  }

  const ordered = [...peaks].sort((left, right) => {
    const leftDepth = projectMapPoint(left.x, left.y, 0, view).depth
    const rightDepth = projectMapPoint(right.x, right.y, 0, view).depth
    return rightDepth - leftDepth
  })
  const pointHits: MapPointHit[] = []
  const labelInputs: Array<{ id: string; sx: number; sy: number; textWidth: number }> = []
  const maxWeight = Math.max(1, ...peaks.map((peak) => peak.weight))
  context.font = '500 13px "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif'
  context.textBaseline = 'top'
  for (const peak of ordered) {
    const summit = terrainHeight(peak.x, peak.y, peaks) * HEIGHT_SCALE
    const point = projectMapPoint(peak.x, peak.y, summit, view)
    const presence = 0.55 + 0.45 * (peak.weight / maxWeight)
    const radius = 18 * presence * Math.min(camera.zoom, 1.6)
    const light = context.createRadialGradient(point.sx, point.sy, 0, point.sx, point.sy, radius)
    light.addColorStop(0, 'rgba(255,248,226,0.95)')
    light.addColorStop(0.42, 'rgba(255,226,170,0.28)')
    light.addColorStop(1, 'rgba(255,226,170,0)')
    context.fillStyle = light
    context.beginPath()
    context.arc(point.sx, point.sy, radius, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = peak.id === selectedId ? '#ffe3a3' : '#fff8ea'
    context.beginPath()
    context.arc(point.sx, point.sy, 1.6 + 0.9 * presence, 0, Math.PI * 2)
    context.fill()
    if (peak.id === selectedId) {
      context.strokeStyle = 'rgba(255,231,176,0.9)'
      context.lineWidth = 1.25
      context.beginPath()
      context.arc(point.sx, point.sy, 7, 0, Math.PI * 2)
      context.stroke()
    }
    pointHits.push({ id: peak.id, x: point.sx, y: point.sy, r: Math.max(22, radius * 0.55) })
    labelInputs.push({ id: peak.id, sx: point.sx, sy: point.sy, textWidth: context.measureText(peak.label).width })
  }
  const labelHits = placeMapLabels(labelInputs)
  for (const box of labelHits) {
    const peak = peaks.find((item) => item.id === box.id)
    if (!peak) continue
    context.save()
    context.shadowColor = 'rgba(0,0,0,0.9)'
    context.shadowBlur = 8
    context.fillStyle = peak.id === selectedId ? '#ffe7b0' : 'rgba(244,244,244,0.94)'
    context.fillText(peak.label, box.x, box.y)
    context.restore()
  }
  hits.points = pointHits
  hits.labels = labelHits
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.2 3.2l9.6 9.6M12.8 3.2l-9.6 9.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M5 3.2v9.6L13 8 5 3.2z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4.5 3h2.2v10H4.5zM9.3 3H11.5v10H9.3z" fill="currentColor" />
    </svg>
  )
}
