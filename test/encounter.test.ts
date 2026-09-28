import { describe, expect, it } from 'vitest'
import { isForgotten, isStandaloneSentence, pickEncounters, type EncounterCandidate } from '../src/shared/encounter'

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
})
