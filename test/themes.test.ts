import { describe, expect, it } from 'vitest'
import { clusterHighlights } from '../src/shared/themes'

describe('本机按词归堆', () => {
  it('用词相近的收成一堆，太短的和单独一条留在外面', () => {
    const result = clusterHighlights([
      { bookmarkId: 'b', markText: '价格把分散在各处的知识集中到市场里。' },
      { bookmarkId: 'a', markText: '市场里的价格会把分散的知识集中起来。' },
      { bookmarkId: 'c', markText: '夜里的风从海上吹进窗子里来。' },
      { bookmarkId: 'd', markText: '好。' },
    ])

    expect(result.themes).toHaveLength(1)
    expect(result.themes[0]?.bookmarkIds).toEqual(['a', 'b'])
    expect(result.themes[0]?.name.split(' · ').length).toBeGreaterThanOrEqual(2)
    expect(result.themes[0]?.name.split(' · ').length).toBeLessThanOrEqual(3)
    expect(result.unassigned).toEqual(['c', 'd'])
  })

  it('每句都有的套话不会把不同的意思粘成一堆', () => {
    const filler = '读书的人常常这样想'
    const result = clusterHighlights([
      { bookmarkId: 'm2', markText: `${filler}价格把分散在各处的知识集中到市场` },
      { bookmarkId: 'w1', markText: `${filler}夜里的风从海上吹进窗子` },
      { bookmarkId: 'm1', markText: `${filler}市场里的价格会把分散的知识集中起来` },
      { bookmarkId: 'w2', markText: `${filler}海上的风夜里吹进了窗子` },
    ])

    expect(result.themes.map((theme) => theme.bookmarkIds)).toEqual([
      ['m1', 'm2'],
      ['w1', 'w2'],
    ])
    expect(result.unassigned).toEqual([])
  })

  it('同一批输入两次结果相同', () => {
    const items = [
      { bookmarkId: 'b', markText: '价格把分散在各处的知识集中到市场里。' },
      { bookmarkId: 'a', markText: '市场里的价格会把分散的知识集中起来。' },
    ]
    expect(clusterHighlights(items)).toEqual(clusterHighlights([...items].reverse()))
  })
})
