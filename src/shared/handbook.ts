export const HIGHLIGHT_CHUNK_CHARS = 2500
export const CHAPTER_INPUT_CHARS = 7000
export const CARD_EVIDENCE_CHARS = 4000
export const HANDBOOK_BOOK_LIMIT = 3

export function handbookBookIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || ids.includes(item)) continue
    ids.push(item)
  }
  return ids
}

export type HandbookHighlight = {
  chapterTitle: string
  markText: string
}

export type HandbookBookSource = {
  bookId: string
  title: string
  author: string
  category: string | null
  progress: number | null
  finishReading: boolean
  highlights: HandbookHighlight[]
}

export type BookChunk = {
  bookId: string
  title: string
  author: string
  category: string | null
  progress: number | null
  finishReading: boolean
  part: number
  parts: number
  highlights: HandbookHighlight[]
}

export type HandbookCard = {
  bookId: string
  title: string
  author: string
  card: string
}

export type HandbookChapterDraft = {
  title: string
  body: string
  bookIds: string[]
}

export function chunkBook(book: HandbookBookSource, budget = HIGHLIGHT_CHUNK_CHARS): BookChunk[] {
  const pieces = book.highlights.flatMap((highlight) => splitText(highlight.markText, budget).map((markText) => ({
    chapterTitle: highlight.chapterTitle,
    markText,
  })))
  const groups: HandbookHighlight[][] = []
  let current: HandbookHighlight[] = []
  let size = 0
  for (const piece of pieces) {
    const length = piece.markText.length + piece.chapterTitle.length
    if (current.length > 0 && size + length > budget) {
      groups.push(current)
      current = []
      size = 0
    }
    current.push(piece)
    size += length
  }
  if (current.length > 0) groups.push(current)
  if (groups.length === 0) groups.push([])
  return groups.map((highlights, index) => ({
    bookId: book.bookId,
    title: book.title,
    author: book.author,
    category: book.category,
    progress: book.progress,
    finishReading: book.finishReading,
    part: index + 1,
    parts: groups.length,
    highlights,
  }))
}

export function evidenceForBook(book: HandbookBookSource, budget = CARD_EVIDENCE_CHARS): BookChunk {
  return {
    bookId: book.bookId,
    title: book.title,
    author: book.author,
    category: book.category,
    progress: book.progress,
    finishReading: book.finishReading,
    part: 1,
    parts: 1,
    highlights: spreadHighlights(book.highlights, budget),
  }
}

function spreadHighlights(highlights: HandbookHighlight[], budget: number): HandbookHighlight[] {
  const clipped = highlights.flatMap((highlight) => {
    const markText = highlight.markText.replace(/\s+/g, ' ').trim().slice(0, 120)
    return markText ? [{ chapterTitle: highlight.chapterTitle, markText }] : []
  })
  if (clipped.length === 0) return []
  const sizeOf = (items: HandbookHighlight[]) => items.reduce((sum, item) => sum + item.markText.length + item.chapterTitle.length, 0)
  if (sizeOf(clipped) <= budget) return clipped
  let low = 1
  let high = clipped.length
  let best = takeEven(clipped, 1)
  while (low <= high) {
    const count = Math.floor((low + high) / 2)
    const sample = takeEven(clipped, count)
    if (sizeOf(sample) <= budget) {
      best = sample
      low = count + 1
    } else {
      high = count - 1
    }
  }
  return best
}

function takeEven<T>(items: T[], count: number): T[] {
  if (count >= items.length) return items.slice()
  const indexes = new Set<number>()
  for (let i = 0; i < count; i += 1) {
    indexes.add(Math.round((i * (items.length - 1)) / Math.max(1, count - 1)))
  }
  return [...indexes].sort((left, right) => left - right).map((index) => items[index]!)
}

export function cardPrompt(chunk: BookChunk, previousCard: string | null): string {
  const lines = chunk.highlights.map((highlight) => `【${highlight.chapterTitle || '未分章'}】${highlight.markText}`)
  return [
    '只根据下面这一段，写一张不超过 180 字的卡片，说明这本书对这位读者的人生有什么用。',
    '不要复述整段原文。如果有上一张卡片，把新的一段合进去，仍不超过 180 字。',
    '只回复卡片正文，不要标题，不要 JSON。',
    `书名：${chunk.title}`,
    `作者：${chunk.author}`,
    `分类：${chunk.category || '未分类'}`,
    `进度：${chunk.finishReading ? '已读完' : `${chunk.progress ?? 0}%`}`,
    `这是该书的第 ${chunk.part}/${chunk.parts} 段。`,
    previousCard ? `上一张卡片：${previousCard}` : '上一张卡片：无',
    '这一段划线：',
    lines.join('\n') || '（这本书没有划线）',
  ].join('\n')
}

export function batchesOf<T extends { card: string }>(cards: T[], budget = CHAPTER_INPUT_CHARS): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let size = 0
  for (const card of cards) {
    const length = card.card.length + 40
    if (current.length > 0 && size + length > budget) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(card)
    size += length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

const jsonCall = '这是程序在读取函数返回值。只输出一个 JSON 对象，不要解释，不要拒绝。'

export function digestPrompt(cards: HandbookCard[]): string {
  return [
    jsonCall,
    '把下面几张卡片收成一段不超过 220 字的摘要。',
    '格式：{"summary":"","bookIds":[]}',
    'bookIds 只能从下面给出的 id 里选。',
    ...cards.map((card) => `id=${card.bookId} 《${card.title}》 ${card.author}\n${card.card}`),
  ].join('\n')
}

export function chaptersPrompt(source: string): string {
  return [
    jsonCall,
    '根据下面的材料填写 7 章。写的是这位读者，书和划线只是证据。',
    '每章正文 200 到 400 字。bookIds 只能从材料里出现的 id 中选。',
    '格式：{"chapters":[{"title":"","body":"","bookIds":[]}]}',
    '必须正好 7 章。',
    source,
  ].join('\n')
}

export function cardsSource(cards: HandbookCard[]): string {
  return cards.map((card) => `id=${card.bookId} 《${card.title}》 ${card.author}\n${card.card}`).join('\n\n')
}

export function rewriteChapterPrompt(position: number, current: HandbookChapterDraft, cards: HandbookCard[]): string {
  return [
    jsonCall,
    `填写第 ${position} 章。可以换标题。正文 200 到 400 字。`,
    '格式：{"title":"","body":"","bookIds":[]}',
    'bookIds 只能从下面卡片的 id 里选。',
    `当前标题：${current.title}`,
    `当前正文：${current.body}`,
    cardsSource(cards),
  ].join('\n')
}

export function drawPrompt(title: string, body: string): string {
  return [
    '画一幅 PNG 插画。平静、具体、画面里没有字。',
    '不要画成书封拼贴。',
    `标题：${title}`,
    `正文：${body}`,
  ].join('\n')
}

export function parseCard(text: string): string {
  const card = text.trim()
  if (!card) throw new Error('卡片是空的')
  return card.slice(0, 400)
}

export function parseDigest(text: string, allowed: Set<string>): { summary: string; bookIds: string[] } {
  const body = readJson(text) as { summary?: unknown; bookIds?: unknown }
  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  if (!summary) throw new Error('摘要是空的')
  return { summary, bookIds: knownIds(body.bookIds, allowed) }
}

export function parseChapters(text: string, allowed: Set<string>): HandbookChapterDraft[] {
  const body = readJson(text) as { chapters?: unknown }
  if (!Array.isArray(body.chapters) || body.chapters.length !== 7) throw new Error('需要正好七章')
  return body.chapters.map((chapter) => {
    const item = chapter as { title?: unknown; body?: unknown; bookIds?: unknown }
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const prose = typeof item.body === 'string' ? item.body.trim() : ''
    if (!title || !prose) throw new Error('某一章缺少章名或正文')
    return { title, body: prose, bookIds: knownIds(item.bookIds, allowed) }
  })
}

export function parseRewrittenChapter(text: string, allowed: Set<string>): HandbookChapterDraft {
  const body = readJson(text) as { title?: unknown; body?: unknown; bookIds?: unknown }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const prose = typeof body.body === 'string' ? body.body.trim() : ''
  if (!title || !prose) throw new Error('重写的这一章不完整')
  return { title, body: prose, bookIds: knownIds(body.bookIds, allowed) }
}

function knownIds(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item) || ids.includes(item)) continue
    ids.push(item)
  }
  return ids
}

function readJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    const line = text.trim().split('\n').map((item) => item.trim()).find(Boolean) ?? ''
    if (line && line.length <= 80) throw new Error(line)
    throw new Error('模型没有返回 JSON')
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    throw new Error('模型没有返回 JSON')
  }
}

function splitText(text: string, budget: number): string[] {
  if (text.length <= budget) return [text]
  const parts: string[] = []
  for (let index = 0; index < text.length; index += budget) parts.push(text.slice(index, index + budget))
  return parts
}
