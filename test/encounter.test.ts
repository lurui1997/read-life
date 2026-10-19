import { describe, expect, it } from 'vitest'
import { aggregateEncounters, inReadingScope, isForgotten, isStandaloneSentence, pickEncounters, readingScope, type EncounterCandidate, type HighlightLine } from '../src/shared/encounter'

const now = new Date(2026, 8, 28, 12)

function line(patch: Partial<EncounterCandidate> & Pick<EncounterCandidate, 'bookmarkId' | 'markText'>): EncounterCandidate {
  return {
    bookId: 'book',
    title: '旧书',
    chapterUid: 3,
    readUpdateTime: Math.floor(new Date(2024, 0, 1).getTime() / 1000),
    ...patch,
  }
}

describe('还能独立读的划线', () => {
  it('收下完整的一句，放下半句、承接词和长段', () => {
    expect(isStandaloneSentence('他把窗打开，夜里的风就这样进来了。')).toBe(true)
    expect(isStandaloneSentence('「海面忽然静了下来，灯塔还亮着。」')).toBe(true)
    expect(isStandaloneSentence('The sea went quiet before anyone noticed.')).toBe(true)
    expect(isStandaloneSentence('有人说道："银行的信誉以父传子，财富由此有了自己的风格。')).toBe(false)
    expect(isStandaloneSentence('他把窗打开，夜里的风进来')).toBe(false)
    expect(isStandaloneSentence('但是夜里的风就这样进来了。')).toBe(false)
    expect(isStandaloneSentence('他把窗打开。夜里的风进来了。')).toBe(false)
    expect(isStandaloneSentence('他把窗打开，夜里的风就这样……进来了。')).toBe(false)
    expect(isStandaloneSentence('好。')).toBe(false)
    expect(isStandaloneSentence(`${'很久以前，'.repeat(20)}他还在读书。`)).toBe(false)
  })

  it('每次随机三句，跳过近读的书，重新随机时避开上一批', () => {
    const recent = line({
      bookmarkId: 'new',
      bookId: 'recent-book',
      title: '新书',
      markText: '他把灯关掉，房间就这样安静下来。',
      readUpdateTime: Math.floor(new Date(2026, 8, 1).getTime() / 1000),
    })
    const pool = [
      line({ bookmarkId: 'a', markText: '他把窗打开，夜里的风就这样进来了。' }),
      line({ bookmarkId: 'b', markText: '她把信收回抽屉，没有再提起这件事。' }),
      line({ bookmarkId: 'c', markText: '海面忽然静了下来，灯塔却还亮着。' }),
      line({ bookmarkId: 'd', markText: '他把地图折好，决定明天再出发。' }),
      recent,
    ]
    expect(isForgotten(recent.readUpdateTime, now)).toBe(false)
    let index = 0
    const random = () => [0, 0, 0][index++] ?? 0
    const first = pickEncounters(pool, now, 3, random)
    expect(first.map((item) => item.bookmarkId)).toEqual(['a', 'b', 'c'])
    const again = pickEncounters(pool, now, 3, () => 0, new Set(first.map((item) => item.bookmarkId)))
    expect(again.map((item) => item.bookmarkId)).toEqual(['d', 'a', 'b'])
  })

  it('没有合格的句子时什么都不给', () => {
    expect(pickEncounters([line({ bookmarkId: 'x', markText: '但是这句接上文。' })], now)).toEqual([])
  })

  it('已读完和进行中按进度分开，没开始的书只留在所有书籍', () => {
    expect(readingScope('nope')).toBe('all')
    expect(readingScope('finished')).toBe('finished')
    const finished = { finishReading: true, progress: 40 }
    const doneByProgress = { finishReading: false, progress: 100 }
    const reading = { finishReading: false, progress: 12 }
    const unread = { finishReading: false, progress: 0 }
    const unknown = { finishReading: false, progress: null }
    expect(inReadingScope(finished, 'finished')).toBe(true)
    expect(inReadingScope(doneByProgress, 'finished')).toBe(true)
    expect(inReadingScope(reading, 'finished')).toBe(false)
    expect(inReadingScope(reading, 'reading')).toBe(true)
    expect(inReadingScope(unread, 'reading')).toBe(false)
    expect(inReadingScope(unknown, 'reading')).toBe(false)
    expect(inReadingScope(unread, 'all')).toBe(true)
  })

  it('按分类和分组把还能独立读的句子聚到一起', () => {
    const ancient = Math.floor(new Date(2024, 0, 1).getTime() / 1000)
    const sourced = (patch: Partial<HighlightLine & { groupNames: string[] }> & Pick<HighlightLine, 'bookmarkId' | 'markText'>): HighlightLine & { groupNames: string[] } => ({
      bookId: 'book',
      title: '旧书',
      chapterUid: 1,
      readUpdateTime: ancient,
      finishReading: false,
      progress: 20,
      category: null,
      groupNames: [],
      ...patch,
    })
    const lines = [
      sourced({ bookmarkId: 'a', bookId: 'lit', category: '文学-小说', groupNames: ['枕边', '诗'], markText: '他把窗打开，夜里的风就这样进来了。' }),
      sourced({ bookmarkId: 'b', bookId: 'lit', category: '文学-小说', groupNames: ['枕边', '诗'], markText: '她把信收回抽屉，没有再提起这件事。' }),
      sourced({ bookmarkId: 'c', bookId: 'his', category: '历史', groupNames: [], markText: '他把地图折好，决定明天再出发。' }),
      sourced({ bookmarkId: 'skip', bookId: 'his', category: '历史', groupNames: [], markText: '但是这句接上文。' }),
      sourced({ bookmarkId: 'fresh', bookId: 'now', category: '历史', groupNames: ['枕边'], markText: '他把灯关掉，房间就这样安静下来。', readUpdateTime: Math.floor(new Date(2026, 8, 1).getTime() / 1000) }),
    ]
    const categories = aggregateEncounters(lines, 'category', now, 1, () => 0)
    expect(categories.map((section) => [section.key, section.lineCount, section.bookCount, section.encounters.length])).toEqual([
      ['历史', 3, 2, 1],
      ['文学', 2, 1, 1],
    ])
    const groups = aggregateEncounters(lines, 'group', now, 3, () => 0)
    expect(Object.fromEntries(groups.map((section) => [section.key, section.lineCount]))).toEqual({
      枕边: 3,
      诗: 2,
      未分组: 2,
    })
    expect(groups.at(-1)?.key).toBe('未分组')
    expect(groups.find((section) => section.key === '枕边')?.encounters.map((item) => item.bookmarkId)).toEqual(['a', 'b'])
    expect(groups.find((section) => section.key === '未分组')?.bookCount).toBe(1)
  })
})
