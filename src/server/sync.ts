import type { AppDatabase, ProgressCursor } from './db'
import type { SyncRecord } from '../shared/types'
import { normalizeProgress } from '../shared/progress'
import { WereadError, type WereadClient } from './weread'

type ShelfBook = {
  bookId: string
  title: string
  author: string
  cover: string
  readUpdateTime: number | null
  category: string | null
  finishReading: boolean
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

const SYNC_CONCURRENCY = 8

type ArchiveGroup = {
  name: string
  bookIds: string[]
}

export async function refreshShelfCatalog(
  db: AppDatabase,
  client: WereadClient,
): Promise<{ bookCount: number; archiveCount: number }> {
  const shelf = await fetchShelf(client)
  applyShelf(db, shelf.books, shelf.archive)
  return { bookCount: shelf.books.length, archiveCount: shelf.archive.length }
}

export async function runSync(
  db: AppDatabase,
  client: WereadClient,
  options: { force: boolean; onProgress?: (done: number, total: number) => void },
): Promise<SyncRecord> {
  const startedAt = new Date().toISOString()
  try {
    const shelf = await fetchShelf(client)
    const noteCounts = await fetchNoteCounts(client)
    applyShelf(db, shelf.books, shelf.archive)
    options.onProgress?.(0, shelf.books.length)
    const tally = { updated: 0, skipped: 0, failed: 0, errors: [] as SyncRecord['errors'] }
    let done = 0
    await eachBook(shelf.books, async (book) => {
      const outcome = await syncOneBook(db, client, book, noteCounts.get(book.bookId) ?? 0, options.force)
      tally.errors.push(...outcome.errors)
      if (outcome.failed) tally.failed += 1
      else if (outcome.wrote) tally.updated += 1
      else tally.skipped += 1
      done += 1
      options.onProgress?.(done, shelf.books.length)
    })
    const record: SyncRecord = {
      startedAt,
      finishedAt: new Date().toISOString(),
      shelfCount: shelf.books.length,
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

function applyShelf(db: AppDatabase, shelf: ShelfBook[], archive: ArchiveGroup[]) {
  for (const book of shelf) {
    db.upsertShelfBook(book)
  }
  db.markAbsentOffShelf(shelf.map((book) => book.bookId))
  db.replaceArchiveGroups(archive)
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
    const data = (await callWithRetry(() => client.call('/book/getprogress', { bookId: book.bookId }))) as {
      book?: { progress?: unknown; readingTime?: unknown; recordReadingTime?: unknown }
    }
    const rawProgress = typeof data.book?.progress === 'number' ? Math.round(data.book.progress) : 0
    const progress = normalizeProgress(rawProgress, book.finishReading) ?? 0
    const readingTime = typeof data.book?.readingTime === 'number'
      ? Math.round(data.book.readingTime)
      : typeof data.book?.recordReadingTime === 'number'
        ? Math.round(data.book.recordReadingTime)
        : 0
    const nextCursor: ProgressCursor =
      book.readUpdateTime == null ? { kind: 'missing' } : { kind: 'time', time: book.readUpdateTime }
    db.setProgress(book.bookId, progress, readingTime, nextCursor)
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
  if (noteCount === 0 && savedNoteCount === 0) {
    if (synced) return 'skip'
    db.replaceHighlights(bookId, 0, [], [])
    return 'write'
  }
  if (!force && synced && savedNoteCount === noteCount) return 'skip'
  try {
    const data = (await callWithRetry(() => client.call('/book/bookmarklist', { bookId }))) as {
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

async function callWithRetry(request: () => Promise<unknown>, attempts = 3): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await request()
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await delay(400 * (attempt + 1))
    }
  }
  throw lastError
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function eachBook(books: ShelfBook[], worker: (book: ShelfBook) => Promise<void>) {
  let index = 0
  const runners = Array.from({ length: Math.min(SYNC_CONCURRENCY, books.length) }, async () => {
    while (index < books.length) {
      const current = books[index]
      index += 1
      await worker(current)
    }
  })
  await Promise.all(runners)
}

function sameClock(incoming: number | null, cursor: ProgressCursor): boolean {
  if (cursor.kind === 'never') return false
  if (incoming == null && cursor.kind === 'missing') return true
  if (incoming != null && cursor.kind === 'time' && cursor.time === incoming) return true
  return false
}

async function fetchShelf(client: WereadClient): Promise<{ books: ShelfBook[]; archive: ArchiveGroup[] }> {
  const data = (await client.call('/shelf/sync')) as { books?: unknown; archive?: unknown }
  if (!Array.isArray(data.books)) throw new WereadError('书架响应缺少 books')
  return {
    books: data.books.map(parseShelfBook),
    archive: parseArchiveGroups(data.archive),
  }
}

function parseArchiveGroups(value: unknown): ArchiveGroup[] {
  if (!Array.isArray(value)) return []
  const groups: ArchiveGroup[] = []
  for (const item of value) {
    const group = asRecord(item)
    const name = group.name
    const bookIds = group.bookIds
    if (typeof name !== 'string' || name.length === 0 || !Array.isArray(bookIds)) continue
    groups.push({
      name,
      bookIds: bookIds.filter((bookId): bookId is string => typeof bookId === 'string' && bookId.length > 0),
    })
  }
  return groups
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
    category: typeof book.category === 'string' && book.category.length > 0 ? book.category : null,
    finishReading: book.finishReading === 1,
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
