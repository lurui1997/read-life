export type BookInfoFields = {
  category: string | null
  newRating: number | null
  ratingLabel: string | null
}

export function parseBookInfo(data: unknown): BookInfoFields {
  const root = asRecord(data)
  const book = asRecord(root.book ?? root)
  const detail = asRecord(book.newRatingDetail)
  return {
    category: typeof book.category === 'string' && book.category.length > 0 ? book.category : null,
    newRating: typeof book.newRating === 'number' ? Math.round(book.newRating) : null,
    ratingLabel: typeof detail.title === 'string' && detail.title.length > 0 ? detail.title : null,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}
