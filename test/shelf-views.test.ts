import { describe, expect, it } from 'vitest'
import { applyRandomOrder, buildShelfSections, pickRandomBook, shuffleBooks } from '../src/web/shelf-views'
import type { BookSummary } from '../src/shared/types'

function book(overrides: Partial<BookSummary> & Pick<BookSummary, 'bookId' | 'title'>): BookSummary {
  return {
    author: '作者',
    cover: '',
    readUpdateTime: 1_700_000_000,
    progress: 10,
    readingTimeSeconds: 100,
    finishReading: false,
    highlightCount: 0,
    category: null,
    newRating: null,
    ratingLabel: null,
    wereadUrl: 'https://weread.qq.com/web/reader/x',
    ...overrides,
  }
}

describe('书架视图', () => {
  it('按分组展示微信读书分组，其余进未分组', () => {
    const sections = buildShelfSections(
      [book({ bookId: 'a', title: '甲' }), book({ bookId: 'b', title: '乙' })],
      [{ name: '技术', bookIds: ['a'] }],
      'archive',
    )
    expect(sections.map((section) => section.label)).toEqual(['技术', '未分组'])
    expect(sections[0]?.books.map((item) => item.bookId)).toEqual(['a'])
  })

  it('按进度分成在读、未读、已读完', () => {
    const sections = buildShelfSections(
      [
        book({ bookId: 'r', title: '在读', progress: 20 }),
        book({ bookId: 'u', title: '未读', progress: 0 }),
        book({ bookId: 'f', title: '读完', progress: 100 }),
      ],
      [],
      'progress',
    )
    expect(sections.map((section) => section.label)).toEqual(['在读', '未读', '已读完'])
  })

  it('按推荐值和分类分组', () => {
    const byRating = buildShelfSections(
      [book({ bookId: '1', title: '神', newRating: 930, ratingLabel: '神作' })],
      [],
      'rating',
    )
    expect(byRating[0]?.label).toBe('神作')

    const byCategory = buildShelfSections(
      [book({ bookId: '2', title: '科幻', category: '精品小说-科幻小说' })],
      [],
      'category',
    )
    expect(byCategory[0]?.label).toBe('精品小说')
  })

  it('随机一本从书架上挑', () => {
    const picked = pickRandomBook([
      book({ bookId: '1', title: '一' }),
      book({ bookId: '2', title: '二' }),
    ])
    expect(picked?.bookId).toMatch(/^[12]$/)
  })

  it('随机模式按进度分组', () => {
    const sections = buildShelfSections(
      [
        book({ bookId: 'r', title: '在读', progress: 20 }),
        book({ bookId: 'u', title: '未读', progress: 0 }),
      ],
      [],
      'random',
    )
    expect(sections.map((section) => section.label)).toEqual(['在读', '未读'])
  })

  it('每个分组都会随机排列', () => {
    const many = Array.from({ length: 120 }, (_, index) =>
      book({ bookId: `b${index}`, title: `书${index}`, readUpdateTime: index }),
    )
    const few = [book({ bookId: 'a', title: '甲', readUpdateTime: 99 })]
    const shuffled = applyRandomOrder(
      [
        { key: 'big', label: '大组', books: many },
        { key: 'small', label: '小组', books: few },
      ],
      42,
    )
    expect(shuffled[0]?.books).not.toEqual(many)
    expect(shuffled[0]?.books).toHaveLength(120)
    expect(shuffled[1]?.books).toEqual(few)
  })

  it('相同 seed 得到稳定顺序', () => {
    const books = Array.from({ length: 120 }, (_, index) =>
      book({ bookId: `b${index}`, title: `书${index}` }),
    )
    const first = shuffleBooks(books, 7).map((item) => item.bookId)
    const second = shuffleBooks(books, 7).map((item) => item.bookId)
    expect(first).toEqual(second)
    expect(first).not.toEqual(books.map((item) => item.bookId))
  })
})
