import { describe, expect, it } from 'vitest'
import { parseBookInfo } from '../src/server/book-info'

describe('书籍详情解析', () => {
  it('支持顶层和 book 嵌套字段', () => {
    expect(parseBookInfo({
      category: '精品小说-科幻小说',
      newRating: 930,
      newRatingDetail: { title: '神作' },
    })).toEqual({
      category: '精品小说-科幻小说',
      newRating: 930,
      ratingLabel: '神作',
    })

    expect(parseBookInfo({
      book: {
        category: '心理-成长',
        newRating: 820,
        newRatingDetail: { title: '好评如潮' },
      },
    })).toEqual({
      category: '心理-成长',
      newRating: 820,
      ratingLabel: '好评如潮',
    })
  })
})
