import { describe, expect, it } from 'vitest'
import {
  cardPrompt,
  cardsSource,
  chaptersPrompt,
  chunkBook,
  parseChapters,
  parseRewrittenChapter,
  type HandbookBookSource,
} from '../src/shared/handbook'

function book(bookId: string, title: string, markText: string): HandbookBookSource {
  return {
    bookId,
    title,
    author: '作者',
    category: null,
    progress: 100,
    finishReading: true,
    highlights: [{ chapterTitle: '第一章', markText }],
  }
}

describe('人生手册材料', () => {
  it('读一本书时不带上另一本书的划线', () => {
    const alpha = book('a', '甲书', '甲书独有句子阿尔法')
    const beta = book('b', '乙书', '乙书独有句子贝塔')
    const prompt = cardPrompt(chunkBook(alpha)[0]!, null)
    expect(prompt).toContain('甲书独有句子阿尔法')
    expect(prompt).not.toContain('乙书独有句子贝塔')
    expect(cardPrompt(chunkBook(beta)[0]!, null)).not.toContain('甲书独有句子阿尔法')
  })

  it('七章只用卡片，不带回原始划线', () => {
    const source = cardsSource([{
      bookId: 'a',
      title: '甲书',
      author: '作者',
      card: '读者学会把决定推迟到信息足够的时候。',
    }])
    const prompt = chaptersPrompt(source)
    expect(prompt).toContain('读者学会把决定推迟')
    expect(prompt).not.toContain('甲书独有句子阿尔法')
    expect(prompt).toContain('必须正好 7 章')
  })

  it('丢掉不在架上的书，并且只要七章', () => {
    const text = JSON.stringify({
      chapters: Array.from({ length: 7 }, (_, index) => ({
        title: `第${index + 1}章`,
        body: '正文',
        bookIds: index === 0 ? ['a', 'missing'] : ['a'],
      })),
    })
    const chapters = parseChapters(text, new Set(['a']))
    expect(chapters).toHaveLength(7)
    expect(chapters[0]?.bookIds).toEqual(['a'])
    expect(() => parseChapters(JSON.stringify({ chapters: [] }), new Set(['a']))).toThrow(/七章/)
  })

  it('从代码块里取出一章，拒绝语原样抛出', () => {
    const text = '```json\n{"title":"章","body":"正文","bookIds":["a","missing"]}\n```'
    expect(parseRewrittenChapter(text, new Set(['a']))).toEqual({ title: '章', body: '正文', bookIds: ['a'] })
    expect(() => parseRewrittenChapter('只处理技术问题。', new Set())).toThrow('只处理技术问题。')
  })

  it('过长的划线按段切开，后一段不进入前一张卡片', () => {
    const long = book('a', '甲书', `${'前'.repeat(2500)}后段标记`)
    const chunks = chunkBook(long)
    expect(chunks.length).toBeGreaterThan(1)
    expect(cardPrompt(chunks[0]!, null)).not.toContain('后段标记')
    expect(cardPrompt(chunks.at(-1)!, null)).toContain('后段标记')
  })
})
