import type { BookSummary } from '../shared/types'

export type ShelfMode = 'archive' | 'progress' | 'rating' | 'category' | 'random'

export type ShelfSection = {
  key: string
  label: string
  books: BookSummary[]
}

export const RANDOM_ORDER_THRESHOLD = 100

export function buildShelfSections(
  books: BookSummary[],
  archiveGroups: Array<{ name: string; bookIds: string[] }>,
  mode: ShelfMode,
): ShelfSection[] {
  if (mode === 'random') return groupByProgress(books)
  if (mode === 'archive') return groupByArchive(books, archiveGroups)
  if (mode === 'progress') return groupByProgress(books)
  if (mode === 'rating') return groupByRating(books)
  return groupByCategory(books)
}

function groupByArchive(
  books: BookSummary[],
  archiveGroups: Array<{ name: string; bookIds: string[] }>,
): ShelfSection[] {
  const byId = new Map(books.map((book) => [book.bookId, book]))
  const placed = new Set<string>()
  const sections = archiveGroups
    .map((group) => {
      const grouped = group.bookIds.map((bookId) => byId.get(bookId)).filter((book): book is BookSummary => book != null)
      grouped.forEach((book) => placed.add(book.bookId))
      return grouped.length > 0 ? { key: group.name, label: group.name, books: grouped } : null
    })
    .filter((section): section is ShelfSection => section != null)
  const rest = books.filter((book) => !placed.has(book.bookId))
  if (rest.length > 0) sections.push({ key: 'ungrouped', label: '未分组', books: rest })
  return sections
}

function groupByProgress(books: BookSummary[]): ShelfSection[] {
  const unread: BookSummary[] = []
  const reading: BookSummary[] = []
  const finished: BookSummary[] = []
  for (const book of books) {
    const progress = book.progress ?? 0
    if (book.finishReading || progress >= 100) finished.push(book)
    else if (progress > 0) reading.push(book)
    else unread.push(book)
  }
  return [
    { key: 'reading', label: '在读', books: sortByRecent(reading) },
    { key: 'unread', label: '未读', books: sortByRecent(unread) },
    { key: 'finished', label: '已读完', books: sortByRecent(finished) },
  ].filter((section) => section.books.length > 0)
}

function groupByRating(books: BookSummary[]): ShelfSection[] {
  const buckets = new Map<string, BookSummary[]>()
  for (const book of books) {
    const label = ratingBucket(book)
    const list = buckets.get(label) ?? []
    list.push(book)
    buckets.set(label, list)
  }
  const order = ['神作', '好评如潮', '值得一读', '褒贬不一', '评分一般', '暂无评分']
  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({
      key: label,
      label,
      books: sortByRating(buckets.get(label) ?? []),
    }))
}

function groupByCategory(books: BookSummary[]): ShelfSection[] {
  const buckets = new Map<string, BookSummary[]>()
  for (const book of books) {
    const label = topCategory(book.category)
    const list = buckets.get(label) ?? []
    list.push(book)
    buckets.set(label, list)
  }
  return [...buckets.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0], 'zh-CN'))
    .map(([label, grouped]) => ({
      key: label,
      label,
      books: sortByRecent(grouped),
    }))
}

function ratingBucket(book: BookSummary): string {
  if (book.ratingLabel) return book.ratingLabel
  const rating = book.newRating
  if (rating == null) return '暂无评分'
  if (rating >= 900) return '神作'
  if (rating >= 800) return '好评如潮'
  if (rating >= 700) return '值得一读'
  if (rating >= 600) return '褒贬不一'
  return '评分一般'
}

function topCategory(category: string | null): string {
  if (!category) return '未分类'
  const head = category.split('-')[0]?.trim()
  return head || '未分类'
}

function sortByRecent(books: BookSummary[]): BookSummary[] {
  return [...books].sort((left, right) => (right.readUpdateTime ?? 0) - (left.readUpdateTime ?? 0))
}

function sortByRating(books: BookSummary[]): BookSummary[] {
  return [...books].sort((left, right) => (right.newRating ?? -1) - (left.newRating ?? -1))
}

export function pickRandomBook(books: BookSummary[]): BookSummary | null {
  if (books.length === 0) return null
  return books[Math.floor(Math.random() * books.length)] ?? null
}

export function applyRandomOrder(
  sections: ShelfSection[],
  seed: number,
  threshold = RANDOM_ORDER_THRESHOLD,
): ShelfSection[] {
  return sections.map((section) => ({
    ...section,
    books:
      section.books.length > threshold
        ? shuffleBooks(section.books, seed + hashString(section.key))
        : section.books,
  }))
}

export function shuffleBooks(books: BookSummary[], seed: number): BookSummary[] {
  const result = [...books]
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1))
    const current = result[index]
    result[index] = result[swap]!
    result[swap] = current!
  }
  return result
}

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0
  }
  return hash >>> 0
}
