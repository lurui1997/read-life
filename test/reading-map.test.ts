import { describe, expect, it } from 'vitest'
import { createApp } from '../src/server/app'
import {
  booksForPeak,
  buildPeaks,
  buildTerrain,
  filterBooksByMonth,
  listMonths,
  pickMapHit,
  placeMapLabels,
  projectMapPoint,
  type MapSourceBook,
} from '../src/shared/reading-map'
import { fakeWeread, localTimestamp, tempDb } from './helpers'

function source(category: string, highlightCount: number, month = 9, index = 0): MapSourceBook {
  return {
    bookId: `${category}-${index}-${highlightCount}`,
    title: category,
    author: '',
    category,
    highlightCount,
    readUpdateTime: localTimestamp(2026, month, 10 + (index % 10)),
  }
}

describe('阅读地图接口', () => {
  it('在架的书都进入地图，没分类记为未分类', async () => {
    const db = tempDb()
    db.upsertShelfBook({
      bookId: '1',
      title: '思考的技术',
      author: '甲',
      cover: '',
      readUpdateTime: localTimestamp(2026, 9),
      category: '个人成长-认知思维',
    })
    db.replaceHighlights('1', 1, [{ chapterUid: 1, chapterIdx: 1, title: '章' }], [
      { bookmarkId: 'h1', chapterUid: 1, markText: '把复杂的事情拆成可以行走的一步。', range: null },
    ])
    db.upsertShelfBook({
      bookId: '2',
      title: '没有分类',
      author: '',
      cover: '',
      readUpdateTime: localTimestamp(2026, 9),
      category: null,
    })
    db.upsertShelfBook({
      bookId: '3',
      title: '没读过',
      author: '',
      cover: '',
      readUpdateTime: null,
      category: '文学-散文',
    })
    const app = createApp({ db, createClient: () => fakeWeread({}) })
    const map = await (await app.request('/api/map')).json() as { books: Array<{ bookId: string; category: string; highlightCount: number }> }
    expect(map.books.map((book) => book.bookId).sort()).toEqual(['1', '2', '3'])
    expect(map.books.find((book) => book.bookId === '2')?.category).toBe('未分类')
    expect(map.books.find((book) => book.bookId === '1')).toMatchObject({ highlightCount: 1, category: '个人成长-认知思维' })
    const quotes = await (await app.request(`/api/map/quotes?category=${encodeURIComponent('个人成长-认知思维')}`)).json()
    expect(quotes.quotes[0].markText).toContain('复杂')
    expect((await app.request('/api/map/quotes')).status).toBe(400)
    db.close()
  })
})

describe('阅读地图', () => {
  it('划线多的分类成为更高的峰，并标出名字', () => {
    const peaks = buildPeaks([
      source('个人成长-认知思维', 40),
      source('个人成长-认知思维', 20, 9, 1),
      source('文学-外国文学', 2),
      source('计算机-编程设计', 8),
    ])
    expect(peaks[0]?.category).toBe('个人成长-认知思维')
    expect(peaks[0]?.label).toBe('认知思维')
    expect(peaks.every((peak) => peak.label.length > 0)).toBe(true)
    expect(peaks[0]?.highlightCount).toBe(60)
    expect(peaks.every((peak) => Number.isFinite(peak.x) && Number.isFinite(peak.y))).toBe(true)
    expect(peaks.every((peak) => Math.hypot(peak.x, peak.y) <= 1.01)).toBe(true)
  })

  it('分类再多，每座峰都有名字，叠在一起也不会丢掉', () => {
    const books = Array.from({ length: 20 }, (_, index) => source(`大类${index}-子类${index}`, 30 - index, 9, index))
    const peaks = buildPeaks(books)
    expect(peaks).toHaveLength(18)
    expect(peaks.every((peak) => peak.label.length > 0)).toBe(true)
    const labels = placeMapLabels(peaks.map((peak) => ({ id: peak.id, sx: 200, sy: 200, textWidth: 52 })))
    expect(labels.map((label) => label.id)).toEqual(peaks.map((peak) => peak.id))
    expect(new Set(labels.map((label) => `${label.x},${label.y}`)).size).toBe(labels.length)
  })

  it('同名子类同时上图时带上大类前缀', () => {
    const peaks = buildPeaks([
      source('经济理财-财经', 30),
      source('投资入门-财经', 24),
      source('文学-散文', 1),
    ], { total: 8 })
    const labels = peaks.map((peak) => peak.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.filter((label) => label.endsWith('财经')).every((label) => label.includes('·'))).toBe(true)
  })

  it('按月份只保留当月读过的书', () => {
    const books = [source('历史-历史读物', 5, 8), source('历史-历史读物', 3, 9, 1)]
    expect(listMonths(books).map((month) => month.label)).toEqual(['2026年08月', '2026年09月'])
    expect(filterBooksByMonth(books, '2026-09')).toHaveLength(1)
    const peaks = buildPeaks(filterBooksByMonth(books, '2026-09'))
    expect(booksForPeak(books, peaks[0], '2026-09').map((book) => book.highlightCount)).toEqual([3])
  })

  it('等高线外圈比内圈更宽，高处的点投得更靠上', () => {
    const peaks = buildPeaks([source('心理-认知与行为', 12)], { total: 4 })
    const terrain = buildTerrain(peaks, 36)
    expect(terrain.contours.length).toBeGreaterThan(4)
    const low = radiusOf(terrain.contours[0].segments)
    const high = radiusOf(terrain.contours[terrain.contours.length - 1].segments)
    expect(high).toBeLessThan(low)
    const camera = { yaw: -0.4, pitch: 0.95, zoom: 1, width: 900, height: 700 }
    const ground = projectMapPoint(0, 0, 0, camera)
    const summit = projectMapPoint(0, 0, 1, camera)
    expect(summit.sy).toBeLessThan(ground.sy)
  })

  it('在架书全部计入峰，装不下的分类并进其他', () => {
    const books = [
      source('个人成长-认知思维', 10),
      source('文学-散文', 0, 9, 1),
      source('历史-历史读物', 0, 9, 2),
      source('未分类', 0, 9, 3),
    ]
    const peaks = buildPeaks(books, { total: 2 })
    expect(peaks.reduce((sum, peak) => sum + peak.bookCount, 0)).toBe(books.length)
    const rest = peaks.find((peak) => peak.id === '__rest__')
    expect(rest?.bookCount).toBe(3)
    expect(booksForPeak(books, rest!, null)).toHaveLength(3)
  })

  it('点在光点上会选中这座峰，比文字更优先', () => {
    const points = [
      { id: '近', x: 40, y: 40, r: 18 },
      { id: '远', x: 80, y: 40, r: 18 },
    ]
    const labels = [{ id: '文字', x: 30, y: 20, w: 40, h: 16 }]
    expect(pickMapHit(44, 42, points, labels)).toBe('近')
    expect(pickMapHit(32, 22, [], labels)).toBe('文字')
    expect(pickMapHit(200, 200, points, labels)).toBeNull()
  })
})

function radiusOf(segments: Array<[number, number, number, number]>): number {
  let max = 0
  for (const [ax, ay, bx, by] of segments) {
    max = Math.max(max, Math.hypot(ax, ay), Math.hypot(bx, by))
  }
  return max
}
