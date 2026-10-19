import {
  batchesOf,
  cardPrompt,
  cardsSource,
  chaptersPrompt,
  evidenceForBook,
  digestPrompt,
  drawPrompt,
  parseCard,
  parseChapters,
  parseDigest,
  parseRewrittenChapter,
  rewriteChapterPrompt,
} from '../shared/handbook'
import type { createHandbookStore } from './handbook-db'

async function completeJson(model: HandbookModel, prompt: string): Promise<string> {
  const first = await model.complete(prompt)
  if (first.includes('{') && first.lastIndexOf('}') > first.indexOf('{')) return first
  return model.complete(`上一次没有输出 JSON。不要拒绝，不要解释。只输出一个 JSON 对象。\n${prompt}`)
}

export type HandbookModel = {
  complete(prompt: string): Promise<string>
  draw(prompt: string, file: string): Promise<void>
}

type Store = ReturnType<typeof createHandbookStore>

export async function buildHandbookCards(store: Store, model: HandbookModel, userId: string | undefined, bookIds: string[], onProgress: (done: number, total: number, message: string) => void) {
  const books = store.listHandbookBooks(userId, bookIds)
  if (books.length === 0) throw new Error('架上没有这几本书')
  onProgress(0, books.length, '开始读书架')
  for (const [index, book] of books.entries()) {
    onProgress(index, books.length, `正在读《${book.title}》`)
    const card = parseCard(await model.complete(cardPrompt(evidenceForBook(book), null)))
    store.saveHandbookCard({ bookId: book.bookId, title: book.title, author: book.author, card }, userId)
    onProgress(index + 1, books.length, `已读《${book.title}》`)
  }
}

export async function writeHandbookChapters(store: Store, model: HandbookModel, userId: string | undefined, bookIds: string[], onProgress: (done: number, total: number, message: string) => void) {
  const cards = store.listHandbookCards(userId).filter((card) => bookIds.includes(card.bookId))
  if (cards.length === 0) throw new Error('还没有读过书架')
  const allowed = new Set(cards.map((card) => card.bookId))
  const batches = batchesOf(cards)
  onProgress(0, batches.length + 1, '正在写七章')
  let source = cardsSource(cards)
  if (batches.length > 1) {
    const digests: string[] = []
    for (const [index, batch] of batches.entries()) {
      onProgress(index, batches.length + 1, `正在收第 ${index + 1} 组卡片`)
      const digest = parseDigest(await completeJson(model, digestPrompt(batch)), allowed)
      digests.push(`id 包含 ${digest.bookIds.join('、') || '无'}\n${digest.summary}`)
    }
    source = digests.join('\n\n')
  }
  onProgress(batches.length, batches.length + 1, '正在写七章')
  const chapters = parseChapters(await completeJson(model, chaptersPrompt(source)), allowed)
  store.createHandbook(chapters, userId)
  onProgress(batches.length + 1, batches.length + 1, '七章已经写好')
}

export async function rewriteHandbookChapter(store: Store, model: HandbookModel, userId: string | undefined, handbookId: string, position: number) {
  const chapters = store.listHandbookChapters(handbookId, userId)
  const current = chapters.find((chapter) => chapter.position === position)
  if (!current) throw new Error('还没有这一章')
  const allCards = store.listHandbookCards(userId)
  const cited = allCards.filter((card) => current.bookIds.includes(card.bookId))
  const cards = cited.length > 0 ? cited : allCards.slice(0, 8)
  const allowed = new Set(allCards.map((card) => card.bookId))
  const draft = parseRewrittenChapter(await completeJson(model, rewriteChapterPrompt(position, current, cards)), allowed)
  store.replaceHandbookChapter(handbookId, position, draft, userId)
}

export async function drawHandbookChapter(store: Store, model: HandbookModel, userId: string | undefined, handbookId: string, position: number, file: string) {
  const current = store.listHandbookChapters(handbookId, userId).find((chapter) => chapter.position === position)
  if (!current) throw new Error('还没有这一章')
  await model.draw(drawPrompt(current.title, current.body), file)
  store.markHandbookImage(handbookId, position, userId)
}

