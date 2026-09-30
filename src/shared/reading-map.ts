export type MapSourceBook = {
  bookId: string
  title: string
  author: string
  category: string
  highlightCount: number
  readUpdateTime: number | null
}

export type MapQuote = {
  bookmarkId: string
  bookId: string
  title: string
  markText: string
}

export const UNCATEGORIZED = '未分类'
export const REST_PEAK_ID = '__rest__'

export type MapPeak = {
  id: string
  label: string
  parent: string
  category: string
  categories: string[]
  x: number
  y: number
  weight: number
  highlightCount: number
  bookCount: number
}

export type MapMonth = {
  id: string
  label: string
}

export type TerrainContour = {
  level: number
  segments: Array<[number, number, number, number]>
}

export type TerrainDust = {
  x: number
  y: number
  z: number
  alpha: number
}

export type Terrain = {
  contours: TerrainContour[]
  dust: TerrainDust[]
  maxHeight: number
}

export type MapCamera = {
  yaw: number
  pitch: number
  zoom: number
  width: number
  height: number
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

export function splitCategory(category: string): { parent: string; label: string } {
  const index = category.indexOf('-')
  if (index <= 0 || index === category.length - 1) return { parent: category, label: category }
  return { parent: category.slice(0, index), label: category.slice(index + 1) }
}

export function monthKey(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}`
}

export function formatMonth(id: string): string {
  const [year, month] = id.split('-')
  if (!year || !month) return id
  return `${year}年${month}月`
}

export function listMonths(books: MapSourceBook[]): MapMonth[] {
  const ids = new Set<string>()
  for (const book of books) {
    if (book.readUpdateTime == null || book.readUpdateTime <= 0) continue
    ids.add(monthKey(book.readUpdateTime))
  }
  return [...ids].sort().map((id) => ({ id, label: formatMonth(id) }))
}

export function filterBooksByMonth(books: MapSourceBook[], month: string | null): MapSourceBook[] {
  if (!month) return books
  return books.filter((book) => book.readUpdateTime != null && book.readUpdateTime > 0 && monthKey(book.readUpdateTime) === month)
}

export function buildPeaks(
  books: MapSourceBook[],
  options?: { total?: number },
): MapPeak[] {
  const total = options?.total ?? 18
  const buckets = new Map<string, { highlightCount: number; bookCount: number }>()
  for (const book of books) {
    if (!book.category) continue
    const bucket = buckets.get(book.category) ?? { highlightCount: 0, bookCount: 0 }
    bucket.bookCount += 1
    bucket.highlightCount += book.highlightCount
    buckets.set(book.category, bucket)
  }
  const ranked = [...buckets.entries()]
    .map(([category, bucket]) => ({
      category,
      ...splitCategory(category),
      ...bucket,
      weight: bucket.highlightCount * 4 + bucket.bookCount,
    }))
    .filter((item) => item.weight > 0)
    .sort((left, right) => right.weight - left.weight || left.category.localeCompare(right.category, 'zh'))
  const headCount = ranked.length > total ? total - 1 : ranked.length
  const head = ranked.slice(0, headCount)
  const tail = ranked.slice(headCount)
  if (tail.length > 0) {
    head.push({
      category: REST_PEAK_ID,
      parent: '其他',
      label: '其他',
      highlightCount: tail.reduce((sum, item) => sum + item.highlightCount, 0),
      bookCount: tail.reduce((sum, item) => sum + item.bookCount, 0),
      weight: tail.reduce((sum, item) => sum + item.weight, 0),
    })
  }

  const labelCount = new Map<string, number>()
  for (const item of head) {
    if (item.category === REST_PEAK_ID) continue
    labelCount.set(item.label, (labelCount.get(item.label) ?? 0) + 1)
  }

  const peaks: MapPeak[] = head.map((item) => ({
    id: item.category,
    label: item.category === REST_PEAK_ID
      ? '其他'
      : (labelCount.get(item.label) ?? 0) > 1 ? `${item.parent.slice(0, 2)}·${item.label}` : item.label,
    parent: item.parent,
    category: item.category,
    categories: item.category === REST_PEAK_ID ? tail.map((entry) => entry.category) : [item.category],
    x: 0,
    y: 0,
    weight: item.weight,
    highlightCount: item.highlightCount,
    bookCount: item.bookCount,
  }))
  layoutPeaks(peaks)
  return peaks
}

function layoutPeaks(peaks: MapPeak[]) {
  if (peaks.length === 0) return
  const groups = new Map<string, MapPeak[]>()
  for (const peak of peaks) {
    const list = groups.get(peak.parent) ?? []
    list.push(peak)
    groups.set(peak.parent, list)
  }
  const parents = [...groups.values()].sort((left, right) => {
    const leftWeight = left.reduce((sum, peak) => sum + peak.weight, 0)
    const rightWeight = right.reduce((sum, peak) => sum + peak.weight, 0)
    return rightWeight - leftWeight || left[0].parent.localeCompare(right[0].parent, 'zh')
  })
  parents.forEach((items, index) => {
    const radius = parents.length === 1 ? 0 : 0.18 + 0.7 * Math.sqrt((index + 0.2) / parents.length)
    const angle = index * GOLDEN
    const cx = Math.cos(angle) * radius
    const cy = Math.sin(angle) * radius * 0.82
    items.forEach((peak, childIndex) => {
      if (items.length === 1) {
        peak.x = cx
        peak.y = cy
        return
      }
      const spread = 0.16 + items.length * 0.04
      const childAngle = angle + (childIndex / items.length) * Math.PI * 2
      peak.x = cx + Math.cos(childAngle) * spread
      peak.y = cy + Math.sin(childAngle) * spread * 0.82
    })
  })
  const minDistance = 0.26
  for (let iteration = 0; iteration < 36; iteration += 1) {
    for (let i = 0; i < peaks.length; i += 1) {
      for (let j = i + 1; j < peaks.length; j += 1) {
        const left = peaks[i]
        const right = peaks[j]
        let dx = right.x - left.x
        let dy = right.y - left.y
        const distance = Math.hypot(dx, dy) || 0.0001
        if (distance >= minDistance) continue
        const push = (minDistance - distance) / 2
        dx /= distance
        dy /= distance
        left.x -= dx * push
        left.y -= dy * push
        right.x += dx * push
        right.y += dy * push
      }
    }
  }
  let maxRadius = 0.001
  for (const peak of peaks) maxRadius = Math.max(maxRadius, Math.hypot(peak.x, peak.y))
  if (maxRadius > 1) {
    const scale = 1 / maxRadius
    for (const peak of peaks) {
      peak.x *= scale
      peak.y *= scale
    }
  }
}

export function terrainHeight(x: number, y: number, peaks: MapPeak[]): number {
  if (peaks.length === 0) return 0
  let maxWeight = 0
  let cx = 0
  let cy = 0
  let weightSum = 0
  for (const peak of peaks) {
    maxWeight = Math.max(maxWeight, peak.weight)
    cx += peak.x * peak.weight
    cy += peak.y * peak.weight
    weightSum += peak.weight
  }
  cx /= weightSum
  cy /= weightSum
  let spread = 0.25
  for (const peak of peaks) spread = Math.max(spread, Math.hypot(peak.x - cx, peak.y - cy))
  const islandRadius = spread + 0.42
  const dx0 = x - cx
  const dy0 = y - cy
  const angle = Math.atan2(dy0, dx0)
  const radius = Math.hypot(dx0, dy0)
  const wobble = 1 + 0.2 * Math.sin(angle * 3 + 0.6) + 0.1 * Math.cos(angle * 5 - 0.4)
  const adjusted = radius / wobble
  let height = 0.32 * Math.exp(-(adjusted * adjusted) / (islandRadius * islandRadius * 0.5))
  for (const peak of peaks) {
    const dx = x - peak.x
    const dy = y - peak.y
    const norm = peak.weight / maxWeight
    const amplitude = 0.42 + 1.05 * norm ** 0.72
    const sigma = 0.15 + 0.07 * norm
    height += amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
  }
  return height
}

export function buildTerrain(peaks: MapPeak[], size = 84): Terrain {
  if (peaks.length === 0) return { contours: [], dust: [], maxHeight: 0 }
  const origin = -1.25
  const span = 2.5
  const step = span / size
  const field: number[][] = []
  let maxHeight = 0
  for (let row = 0; row <= size; row += 1) {
    const line: number[] = []
    const y = origin + row * step
    for (let column = 0; column <= size; column += 1) {
      const height = terrainHeight(origin + column * step, y, peaks)
      line.push(height)
      if (height > maxHeight) maxHeight = height
    }
    field.push(line)
  }
  const contours: TerrainContour[] = []
  const steps = 12
  for (let levelIndex = 1; levelIndex <= steps; levelIndex += 1) {
    const level = (maxHeight * levelIndex) / (steps + 1)
    const segments: Array<[number, number, number, number]> = []
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const x = origin + column * step
        const y = origin + row * step
        segments.push(...cellSegments(
          x,
          y,
          step,
          field[row][column],
          field[row][column + 1],
          field[row + 1][column + 1],
          field[row + 1][column],
          level,
        ))
      }
    }
    if (segments.length > 0) contours.push({ level, segments })
  }
  const dust: TerrainDust[] = []
  for (let row = 1; row < size; row += 2) {
    for (let column = 1; column < size; column += 2) {
      const height = field[row][column]
      if (height < maxHeight * 0.18) continue
      const spark = hashUnit(column, row)
      if (spark > 0.42) continue
      dust.push({
        x: origin + column * step,
        y: origin + row * step,
        z: height,
        alpha: 0.18 + spark * 0.55,
      })
    }
  }
  return { contours, dust, maxHeight }
}

function hashUnit(column: number, row: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function mix(startValue: number, endValue: number, start: number, end: number, threshold: number): number {
  const delta = endValue - startValue
  const t = delta === 0 ? 0 : (threshold - startValue) / delta
  return start + (end - start) * t
}

function cellSegments(
  x: number,
  y: number,
  step: number,
  southWest: number,
  southEast: number,
  northEast: number,
  northWest: number,
  threshold: number,
): Array<[number, number, number, number]> {
  let code = 0
  if (southWest >= threshold) code |= 1
  if (southEast >= threshold) code |= 2
  if (northEast >= threshold) code |= 4
  if (northWest >= threshold) code |= 8
  if (code === 0 || code === 15) return []
  const x1 = x + step
  const y1 = y + step
  const south: [number, number] = [mix(southWest, southEast, x, x1, threshold), y]
  const east: [number, number] = [x1, mix(southEast, northEast, y, y1, threshold)]
  const north: [number, number] = [mix(northWest, northEast, x, x1, threshold), y1]
  const west: [number, number] = [x, mix(southWest, northWest, y, y1, threshold)]
  const line = (a: [number, number], b: [number, number]): [number, number, number, number] => [a[0], a[1], b[0], b[1]]
  const table: Record<number, Array<[number, number, number, number]>> = {
    1: [line(west, south)],
    2: [line(south, east)],
    3: [line(west, east)],
    4: [line(east, north)],
    5: [line(west, south), line(east, north)],
    6: [line(south, north)],
    7: [line(west, north)],
    8: [line(north, west)],
    9: [line(south, north)],
    10: [line(south, east), line(north, west)],
    11: [line(east, north)],
    12: [line(east, west)],
    13: [line(south, east)],
    14: [line(south, west)],
  }
  return table[code] ?? []
}

export function projectMapPoint(
  x: number,
  y: number,
  z: number,
  camera: MapCamera,
): { sx: number; sy: number; depth: number } {
  const cosYaw = Math.cos(camera.yaw)
  const sinYaw = Math.sin(camera.yaw)
  const rx = x * cosYaw - y * sinYaw
  const ry = x * sinYaw + y * cosYaw
  const sy = ry * Math.cos(camera.pitch) - z * Math.sin(camera.pitch)
  const scale = camera.zoom * Math.min(camera.width, camera.height) * 0.4
  return {
    sx: camera.width / 2 + rx * scale,
    sy: camera.height * 0.5 + sy * scale,
    depth: ry,
  }
}

export type MapPointHit = { id: string; x: number; y: number; r: number }
export type MapLabelHit = { id: string; x: number; y: number; w: number; h: number }

export function placeMapLabels(
  peaks: Array<{ id: string; sx: number; sy: number; textWidth: number }>,
): MapLabelHit[] {
  const placed: MapLabelHit[] = []
  for (const peak of peaks) placed.push(placeMapLabel(peak.id, peak.sx, peak.sy, peak.textWidth, placed))
  return placed
}

function placeMapLabel(id: string, sx: number, sy: number, textWidth: number, placed: MapLabelHit[]): MapLabelHit {
  const anchors: Array<[number, number]> = [
    [-textWidth / 2, -26],
    [-textWidth / 2, 12],
    [14, -8],
    [-textWidth - 14, -8],
    [-textWidth / 2, -44],
    [-textWidth / 2, 30],
    [16, 16],
    [-textWidth - 16, 16],
  ]
  for (const [dx, dy] of anchors) {
    const box: MapLabelHit = { id, x: sx + dx, y: sy + dy, w: textWidth, h: 16 }
    if (box.y < 8) continue
    if (!labelOverlaps(box, placed)) return box
  }
  for (let ring = 1; ring <= 8; ring += 1) {
    const dist = 20 + ring * 18
    for (let step = 0; step < 8; step += 1) {
      const angle = (step / 8) * Math.PI * 2 - Math.PI / 2
      const box: MapLabelHit = {
        id,
        x: sx + Math.cos(angle) * dist - textWidth / 2,
        y: sy + Math.sin(angle) * dist,
        w: textWidth,
        h: 16,
      }
      if (box.y < 8) continue
      if (!labelOverlaps(box, placed)) return box
    }
  }
  return { id, x: sx - textWidth / 2, y: Math.max(8, sy - 26), w: textWidth, h: 16 }
}

function labelOverlaps(box: MapLabelHit, placed: MapLabelHit[]): boolean {
  return placed.some((item) => (
    box.x < item.x + item.w + 10
    && box.x + box.w + 10 > item.x
    && box.y < item.y + item.h + 6
    && box.y + box.h + 6 > item.y
  ))
}

export function pickMapHit(x: number, y: number, points: MapPointHit[], labels: MapLabelHit[]): string | null {
  let nearest: { id: string; distance: number } | null = null
  for (const point of points) {
    const distance = Math.hypot(x - point.x, y - point.y)
    if (distance > point.r) continue
    if (!nearest || distance < nearest.distance) nearest = { id: point.id, distance }
  }
  if (nearest) return nearest.id
  const label = labels.find((box) => (
    x >= box.x - 8 && x <= box.x + box.w + 8 && y >= box.y - 8 && y <= box.y + box.h + 8
  ))
  return label?.id ?? null
}

export function booksForPeak(books: MapSourceBook[], peak: MapPeak, month: string | null): MapSourceBook[] {
  const categories = new Set(peak.categories)
  return filterBooksByMonth(books, month)
    .filter((book) => categories.has(book.category))
    .sort((left, right) => right.highlightCount - left.highlightCount || left.title.localeCompare(right.title, 'zh'))
}
