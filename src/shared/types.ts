export type SyncError = {
  bookId: string
  message: string
}

export type SyncRecord = {
  startedAt: string
  finishedAt: string
  shelfCount: number
  updated: number
  skipped: number
  failed: number
  message: string
  errors: SyncError[]
}

export type SyncStatus = {
  running: boolean
  last: SyncRecord | null
  done: number
  total: number
}

export type BookSummary = {
  bookId: string
  title: string
  author: string
  cover: string
  readUpdateTime: number | null
  progress: number | null
  readingTimeSeconds: number | null
  finishReading: boolean
  highlightCount: number
  category: string | null
  newRating: number | null
  ratingLabel: string | null
  wereadUrl: string
}

export type BooksResponse = {
  books: BookSummary[]
  archiveGroups: Array<{
    name: string
    bookIds: string[]
  }>
}

export type Highlight = {
  bookmarkId: string
  markText: string
  range: string | null
}

export type Chapter = {
  chapterUid: number
  chapterIdx: number
  title: string
  highlights: Highlight[]
}

export type BookDetail = {
  bookId: string
  title: string
  author: string
  cover: string
  onShelf: boolean
  progress: number | null
  readingTimeSeconds: number | null
  finishReading: boolean
  highlightCount: number
  wereadUrl: string
  chapters: Chapter[]
}
