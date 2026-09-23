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
}

export type BookSummary = {
  bookId: string
  title: string
  author: string
  cover: string
  readUpdateTime: number | null
  progress: number | null
  readingTimeSeconds: number | null
  highlightCount: number
}

export type BooksResponse = {
  groups: Array<{
    year: string
    books: BookSummary[]
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
  highlightCount: number
  chapters: Chapter[]
}
