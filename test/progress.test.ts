import { describe, expect, it } from 'vitest'
import { normalizeProgress } from '../src/shared/progress'

describe('进度归一', () => {
  it('标记读完时显示 100%', () => {
    expect(normalizeProgress(99, true)).toBe(100)
    expect(normalizeProgress(null, true)).toBe(100)
  })

  it('未读完时保留原进度', () => {
    expect(normalizeProgress(99, false)).toBe(99)
    expect(normalizeProgress(null, false)).toBe(null)
  })
})
