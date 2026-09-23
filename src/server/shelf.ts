import type { BookSummary, BooksResponse } from '../shared/types'

export function groupBooks(books: BookSummary[]): BooksResponse {
  const dated = new Map<number, BookSummary[]>()
  const unknown: BookSummary[] = []
  for (const book of books) {
    if (book.readUpdateTime == null) {
      unknown.push(book)
      continue
    }
    const year = new Date(book.readUpdateTime * 1000).getFullYear()
    const list = dated.get(year) ?? []
    list.push(book)
    dated.set(year, list)
  }
  const groups = [...dated.keys()]
    .sort((left, right) => right - left)
    .map((year) => ({
      year: String(year),
      books: sortByRecent(dated.get(year) ?? []),
    }))
  unknown.sort((left, right) => left.bookId.localeCompare(right.bookId))
  if (unknown.length > 0) {
    groups.push({ year: '未知', books: unknown })
  }
  return { groups }
}

function sortByRecent(books: BookSummary[]): BookSummary[] {
  return [...books].sort((left, right) => (right.readUpdateTime ?? 0) - (left.readUpdateTime ?? 0))
}
