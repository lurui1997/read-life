import type { AppDatabase, ProgressCursor } from './db'
import type { SyncRecord } from '../shared/types'
import { WereadError, type WereadClient } from './weread'

type ShelfBook = {
  bookId: string
  title: string
  author: string
  cover: string
  readUpdateTime: number | null
}

type HighlightDraft = {
  bookmarkId: string
  chapterUid: number
  markText: string
  range: string | null
}

type ChapterDraft = {
  chapterUid: number
  chapterIdx: number
  title: string
}

export async function runSync(
  db: AppDatabase,
  client: WereadClient,
  options: { force: boolean },
): Promise<SyncRecord> {
  const startedAt = new Date().toISOString()
  try {
    const shelf = await fetchShelf(client)
    const noteCounts = await fetchNoteCounts(client)
    applyShelf(db, shelf)
    const tally = { updated: 0, skipped: 0, failed: 0, errors: [] as SyncRecord['errors'] }
    for (const book of shelf) {
      const outcome = await syncOneBook(db, client, book, noteCounts.get(book.bookId) ?? 0, options.force)
      tally.errors.push(...outcome.errors)
      if (outcome.failed) tally.failed += 1
      else if (outcome.wrote) tally.updated += 1
      else tally.skipped += 1
    }
    const record: SyncRecord = {
      startedAt,
      finishedAt: new Date().toISOString(),
      shelfCount: shelf.length,
      updated: tally.updated,
      skipped: tally.skipped,
      failed: tally.failed,
      message: '',
      errors: tally.errors,
    }
    db.insertSync(record)
    return record
  } catch (error) {
    const record: SyncRecord = {
      startedAt,
      finishedAt: new Date().toISOString(),
      shelfCount: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      message: error instanceof Error ? error.message : '同步失败',
      errors: [],
    }
    db.insertSync(record)
    return record
  }
}

function applyShelf(db: AppDatabase, shelf: ShelfBook[]) {
  for (const book of shelf) {
    db.upsertShelfBook(book)
  }
  db.markAbsentOffShelf(shelf.map((book) => book.bookId))
}

async function syncOneBook(
  db: AppDatabase,
  client: WereadClient,
  book: ShelfBook,
  noteCount: number,
  force: boolean,
): Promise<{ failed: boolean; wrote: boolean; errors: SyncRecord['errors'] }> {
  const stored = db.getBook(book.bookId)
  const errors: SyncRecord['errors'] = []
  let wrote = false

  const progress = await syncProgress(db, client, book, stored?.progressCursor ?? { kind: 'never' }, force)
  if (progress === 'write') wrote = true
  if (progress === 'fail') errors.push({ bookId: book.bookId, message: '进度同步失败' })

  const highlights = await syncHighlights(db, client, book.bookId, noteCount, stored, force)
  if (highlights === 'write') wrote = true
  if (highlights === 'fail') errors.push({ bookId: book.bookId, message: '划线同步失败' })

  return { failed: errors.length > 0, wrote, errors }
}

async function syncProgress(
  db: AppDatabase,
  client: WereadClient,
  book: ShelfBook,
  cursor: ProgressCursor,
  force: boolean,
): Promise<'skip' | 'write' | 'fail'> {
  if (!force && sameClock(book.readUpdateTime, cursor)) return 'skip'
  try {
    const data = (await client.call('/book/getprogress', { bookId: book.bookId })) as {
      book?: { progress?: unknown; readingTime?: unknown }
    }
    const progress = data.book?.progress
    const readingTime = data.book?.readingTime
    if (typeof progress !== 'number' || typeof readingTime !== 'number') {
      throw new WereadError('进度响应缺少 book.progress 或 book.readingTime')
    }
    const nextCursor: ProgressCursor =
      book.readUpdateTime == null ? { kind: 'missing' } : { kind: 'time', time: book.readUpdateTime }
    db.setProgress(book.bookId, Math.round(progress), Math.round(readingTime), nextCursor)
    return 'write'
  } catch {
    return 'fail'
  }
}

async function syncHighlights(
  db: AppDatabase,
  client: WereadClient,
  bookId: string,
  noteCount: number,
  stored: { highlightsSynced: boolean; savedNoteCount: number } | null,
  force: boolean,
): Promise<'skip' | 'write' | 'fail'> {
  const synced = stored?.highlightsSynced ?? false
  const savedNoteCount = stored?.savedNoteCount ?? 0
  if (!force && synced && savedNoteCount === noteCount) return 'skip'
  try {
    const data = (await client.call('/book/bookmarklist', { bookId })) as {
      updated?: unknown
      chapters?: unknown
    }
    if (!Array.isArray(data.updated)) throw new WereadError('划线响应缺少 updated')
    const highlights = data.updated.map(parseHighlight)
    const chapters = Array.isArray(data.chapters) ? data.chapters.map(parseChapter) : []
    const known = new Set(chapters.map((chapter) => chapter.chapterUid))
    for (const highlight of highlights) {
      if (!known.has(highlight.chapterUid)) {
        chapters.push({ chapterUid: highlight.chapterUid, chapterIdx: Number.MAX_SAFE_INTEGER, title: '未分章' })
        known.add(highlight.chapterUid)
      }
    }
    db.replaceHighlights(bookId, noteCount, chapters, highlights)
    return 'write'
  } catch {
    return 'fail'
  }
}

function sameClock(incoming: number | null, cursor: ProgressCursor): boolean {
  if (cursor.kind === 'never') return false
  if (incoming == null && cursor.kind === 'missing') return true
  if (incoming != null && cursor.kind === 'time' && cursor.time === incoming) return true
  return false
}

async function fetchShelf(client: WereadClient): Promise<ShelfBook[]> {
  const data = (await client.call('/shelf/sync')) as { books?: unknown }
  if (!Array.isArray(data.books)) throw new WereadError('书架响应缺少 books')
  return data.books.map(parseShelfBook)
}

async function fetchNoteCounts(client: WereadClient): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  let lastSort: number | undefined
  for (let page = 0; page < 200; page += 1) {
    const params: Record<string, unknown> = { count: 20 }
    if (lastSort !== undefined) params.lastSort = lastSort
    const data = (await client.call('/user/notebooks', params)) as { books?: unknown; hasMore?: unknown }
    if (!Array.isArray(data.books)) throw new WereadError('笔记本响应缺少 books')
    for (const item of data.books) counts.set(readBookId(item), readNoteCount(item))
    if (data.hasMore !== 1 || data.books.length === 0) return counts
    const sort = (data.books[data.books.length - 1] as { sort?: unknown }).sort
    if (typeof sort !== 'number' || sort === lastSort) return counts
    lastSort = sort
  }
  throw new WereadError('笔记本分页超出上限')
}

function parseShelfBook(value: unknown): ShelfBook {
  const book = asRecord(value)
  const bookId = book.bookId
  if (typeof bookId !== 'string' || bookId.length === 0) throw new WereadError('书架里有缺少 bookId 的书')
  return {
    bookId,
    title: typeof book.title === 'string' ? book.title : '',
    author: typeof book.author === 'string' ? book.author : '',
    cover: typeof book.cover === 'string' ? book.cover : '',
    readUpdateTime: typeof book.readUpdateTime === 'number' ? book.readUpdateTime : null,
  }
}

function parseHighlight(value: unknown): HighlightDraft {
  const item = asRecord(value)
  if (typeof item.bookmarkId !== 'string' || typeof item.chapterUid !== 'number') {
    throw new WereadError('划线缺少 bookmarkId 或 chapterUid')
  }
  return {
    bookmarkId: item.bookmarkId,
    chapterUid: item.chapterUid,
    markText: typeof item.markText === 'string' ? item.markText : '',
    range: typeof item.range === 'string' ? item.range : null,
  }
}

function parseChapter(value: unknown): ChapterDraft {
  const item = asRecord(value)
  if (typeof item.chapterUid !== 'number') throw new WereadError('章节缺少 chapterUid')
  return {
    chapterUid: item.chapterUid,
    chapterIdx: typeof item.chapterIdx === 'number' ? item.chapterIdx : 0,
    title: typeof item.title === 'string' ? item.title : '',
  }
}

function readBookId(value: unknown): string {
  const item = asRecord(value)
  if (typeof item.bookId !== 'string') throw new WereadError('笔记本条目缺少 bookId')
  return item.bookId
}

function readNoteCount(value: unknown): number {
  const item = asRecord(value)
  return typeof item.noteCount === 'number' ? item.noteCount : 0
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object') throw new WereadError('微信读书响应格式不正确')
  return value as Record<string, unknown>
}
