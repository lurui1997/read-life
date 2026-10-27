import { normalizeProgress } from './progress'

export type ProgressCursor = { kind: 'never' } | { kind: 'missing' } | { kind: 'time'; time: number }

export type VaultHighlight = {
  bookmarkId: string
  markText: string
}

export type VaultChapter = {
  chapterUid: number
  chapterIdx: number
  title: string
  highlights: VaultHighlight[]
}

export type VaultBook = {
  bookId: string
  title: string
  author: string
  cover: string
  readUpdateTime: number | null
  category: string | null
  finishReading: boolean
  progress: number | null
  readingTimeSeconds: number | null
  progressCursor: ProgressCursor
  noteCount: number
  savedNoteCount: number
  highlightsSynced: boolean
  chapters: VaultChapter[]
  notePath: string | null
  noteSignature: string
}

export type VaultGroup = {
  name: string
  bookIds: string[]
}

export type VaultCatalog = {
  version: 1
  updatedAt: string | null
  books: VaultBook[]
  groups: VaultGroup[]
}

export type VaultSyncResult = {
  catalog: VaultCatalog
  updated: number
  skipped: number
  failed: number
  errors: Array<{ bookId: string; message: string }>
}

export type Gateway = {
  call(apiName: string, params?: Record<string, unknown>): Promise<unknown>
}

export function emptyCatalog(): VaultCatalog {
  return { version: 1, updatedAt: null, books: [], groups: [] }
}

export function highlightCount(book: VaultBook): number {
  return book.chapters.reduce((sum, chapter) => sum + chapter.highlights.length, 0)
}

export function groupMap(groups: VaultGroup[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const group of groups) {
    for (const bookId of group.bookIds) {
      const names = map.get(bookId) ?? []
      names.push(group.name)
      map.set(bookId, names)
    }
  }
  return map
}

export function parseCatalog(raw: string): VaultCatalog {
  let data: unknown
  try {
    data = JSON.parse(raw) as unknown
  } catch {
    throw new VaultSyncError('折角索引无法读取')
  }
  const record = asRecord(data)
  if (!Array.isArray(record.books) || !Array.isArray(record.groups)) throw new VaultSyncError('折角索引无法读取')
  return {
    version: 1,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    books: record.books.flatMap((item) => {
      const book = restoreBook(item)
      return book ? [book] : []
    }),
    groups: record.groups.filter(isGroup),
  }
}

export class VaultSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultSyncError'
  }
}

const SYNC_CONCURRENCY = 4
const NOTEBOOK_PAGE = 100

export async function syncVaultCatalog(
  previous: VaultCatalog,
  client: Gateway,
  options: {
    force?: boolean
    onProgress?: (progress: { done: number; total: number; phase: 'shelf' | 'books' }) => void
  } = {},
): Promise<VaultSyncResult> {
  const force = options.force ?? false
  options.onProgress?.({ done: 0, total: 0, phase: 'shelf' })
  const [shelf, noteCounts] = await Promise.all([fetchShelf(client), fetchNoteCounts(client)])
  const previousById = new Map(previous.books.map((book) => [book.bookId, book]))
  const books = shelf.books.map((book) => withShelf(previousById.get(book.bookId), book, noteCounts.get(book.bookId) ?? 0))
  options.onProgress?.({ done: 0, total: books.length, phase: 'books' })
  const tally = { updated: 0, skipped: 0, failed: 0, errors: [] as VaultSyncResult['errors'] }
  let done = 0
  await eachBook(books, async (book) => {
    const outcome = await syncOneBook(client, book, force)
    tally.errors.push(...outcome.errors)
    if (outcome.failed) tally.failed += 1
    else if (outcome.wrote) tally.updated += 1
    else tally.skipped += 1
    done += 1
    options.onProgress?.({ done, total: books.length, phase: 'books' })
  })
  return {
    catalog: {
      version: 1,
      updatedAt: new Date().toISOString(),
      books,
      groups: shelf.archive,
    },
    ...tally,
  }
}

async function syncOneBook(client: Gateway, book: VaultBook, force: boolean): Promise<{ failed: boolean; wrote: boolean; errors: VaultSyncResult['errors'] }> {
  const errors: VaultSyncResult['errors'] = []
  let wrote = false
  const [progress, highlights] = await Promise.all([
    syncProgress(client, book, force),
    syncHighlights(client, book, force),
  ])
  if (progress === 'write') wrote = true
  if (progress === 'fail') errors.push({ bookId: book.bookId, message: '进度同步失败' })
  if (highlights === 'write') wrote = true
  if (highlights === 'fail') errors.push({ bookId: book.bookId, message: '划线同步失败' })
  return { failed: errors.length > 0, wrote, errors }
}

async function syncProgress(client: Gateway, book: VaultBook, force: boolean): Promise<'skip' | 'write' | 'fail'> {
  if (!force && sameClock(book.readUpdateTime, book.progressCursor)) return 'skip'
  try {
    const data = (await callWithRetry(() => client.call('/book/getprogress', { bookId: book.bookId }))) as {
      book?: { progress?: unknown; readingTime?: unknown; recordReadingTime?: unknown }
    }
    const rawProgress = typeof data.book?.progress === 'number' ? Math.round(data.book.progress) : 0
    book.progress = normalizeProgress(rawProgress, book.finishReading) ?? 0
    book.readingTimeSeconds = typeof data.book?.readingTime === 'number'
      ? Math.round(data.book.readingTime)
      : typeof data.book?.recordReadingTime === 'number'
        ? Math.round(data.book.recordReadingTime)
        : 0
    book.progressCursor = book.readUpdateTime == null ? { kind: 'missing' } : { kind: 'time', time: book.readUpdateTime }
    return 'write'
  } catch {
    return 'fail'
  }
}

async function syncHighlights(client: Gateway, book: VaultBook, force: boolean): Promise<'skip' | 'write' | 'fail'> {
  const action = highlightsAction(force, book.noteCount, book)
  if (action === 'skip') return 'skip'
  if (action === 'clear') {
    book.chapters = []
    book.highlightsSynced = true
    book.savedNoteCount = 0
    return 'write'
  }
  try {
    const data = await callWithRetry(() => client.call('/book/bookmarklist', { bookId: book.bookId }))
    book.chapters = chaptersFromBookmarkList(data)
    book.highlightsSynced = true
    book.savedNoteCount = book.noteCount
    return 'write'
  } catch {
    return 'fail'
  }
}

function highlightsAction(force: boolean, noteCount: number, book: VaultBook): 'skip' | 'clear' | 'fetch' {
  if (noteCount === 0 && book.savedNoteCount === 0) return book.highlightsSynced ? 'skip' : 'clear'
  if (!force && book.highlightsSynced && book.savedNoteCount === noteCount) return 'skip'
  return 'fetch'
}

type ShelfBook = {
  bookId: string
  title: string
  author: string
  cover: string
  readUpdateTime: number | null
  category: string | null
  finishReading: boolean
}

function withShelf(previous: VaultBook | undefined, shelf: ShelfBook, noteCount: number): VaultBook {
  const base = previous ?? blankBook(shelf)
  return {
    ...base,
    title: shelf.title,
    author: shelf.author,
    cover: shelf.cover,
    readUpdateTime: shelf.readUpdateTime,
    category: shelf.category ?? base.category,
    finishReading: shelf.finishReading,
    noteCount,
  }
}

function blankBook(shelf: ShelfBook): VaultBook {
  return {
    bookId: shelf.bookId,
    title: shelf.title,
    author: shelf.author,
    cover: shelf.cover,
    readUpdateTime: shelf.readUpdateTime,
    category: shelf.category,
    finishReading: shelf.finishReading,
    progress: null,
    readingTimeSeconds: null,
    progressCursor: { kind: 'never' },
    noteCount: 0,
    savedNoteCount: 0,
    highlightsSynced: false,
    chapters: [],
    notePath: null,
    noteSignature: '',
  }
}

async function fetchShelf(client: Gateway): Promise<{ books: ShelfBook[]; archive: VaultGroup[] }> {
  const data = (await callWithRetry(() => client.call('/shelf/sync'))) as { books?: unknown; archive?: unknown }
  if (!Array.isArray(data.books)) throw new VaultSyncError('书架响应缺少 books')
  return {
    books: data.books.map(parseShelfBook),
    archive: parseArchiveGroups(data.archive),
  }
}

async function fetchNoteCounts(client: Gateway): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  let lastSort: number | undefined
  for (let page = 0; page < 200; page += 1) {
    const params: Record<string, unknown> = { count: NOTEBOOK_PAGE }
    if (lastSort !== undefined) params.lastSort = lastSort
    const data = (await callWithRetry(() => client.call('/user/notebooks', params))) as { books?: unknown; hasMore?: unknown }
    if (!Array.isArray(data.books)) throw new VaultSyncError('笔记本响应缺少 books')
    for (const item of data.books) counts.set(readBookId(item), readNoteCount(item))
    if (data.hasMore !== 1 || data.books.length === 0) return counts
    const sort = (data.books[data.books.length - 1] as { sort?: unknown }).sort
    if (typeof sort !== 'number' || sort === lastSort) return counts
    lastSort = sort
  }
  throw new VaultSyncError('笔记本分页超出上限')
}

function chaptersFromBookmarkList(value: unknown): VaultChapter[] {
  const data = asRecord(value)
  if (!Array.isArray(data.updated)) throw new VaultSyncError('划线响应缺少 updated')
  const highlights = data.updated.map(parseHighlight)
  const chapters = Array.isArray(data.chapters) ? data.chapters.map(parseChapter) : []
  const known = new Set(chapters.map((chapter) => chapter.chapterUid))
  for (const highlight of highlights) {
    if (!known.has(highlight.chapterUid)) {
      chapters.push({ chapterUid: highlight.chapterUid, chapterIdx: Number.MAX_SAFE_INTEGER, title: '未分章' })
      known.add(highlight.chapterUid)
    }
  }
  const byChapter = new Map<number, VaultHighlight[]>()
  for (const highlight of highlights) {
    const list = byChapter.get(highlight.chapterUid) ?? []
    list.push({ bookmarkId: highlight.bookmarkId, markText: highlight.markText })
    byChapter.set(highlight.chapterUid, list)
  }
  return chapters
    .sort((left, right) => left.chapterIdx - right.chapterIdx || left.chapterUid - right.chapterUid)
    .map((chapter) => ({ ...chapter, highlights: byChapter.get(chapter.chapterUid) ?? [] }))
    .filter((chapter) => chapter.highlights.length > 0)
}

function parseShelfBook(value: unknown): ShelfBook {
  const book = asRecord(value)
  const bookId = book.bookId
  if (typeof bookId !== 'string' || bookId.length === 0) throw new VaultSyncError('书架里有缺少 bookId 的书')
  return {
    bookId,
    title: typeof book.title === 'string' ? book.title : '',
    author: typeof book.author === 'string' ? book.author : '',
    cover: typeof book.cover === 'string' ? book.cover : '',
    readUpdateTime: typeof book.readUpdateTime === 'number' ? book.readUpdateTime : null,
    category: typeof book.category === 'string' && book.category.length > 0 ? book.category : null,
    finishReading: book.finishReading === 1 || book.finishReading === true,
  }
}

function parseArchiveGroups(value: unknown): VaultGroup[] {
  if (!Array.isArray(value)) return []
  const groups: VaultGroup[] = []
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

function parseHighlight(value: unknown): { bookmarkId: string; chapterUid: number; markText: string } {
  const item = asRecord(value)
  if (typeof item.bookmarkId !== 'string' || typeof item.chapterUid !== 'number') {
    throw new VaultSyncError('划线缺少 bookmarkId 或 chapterUid')
  }
  return {
    bookmarkId: item.bookmarkId,
    chapterUid: item.chapterUid,
    markText: typeof item.markText === 'string' ? item.markText : '',
  }
}

function parseChapter(value: unknown): { chapterUid: number; chapterIdx: number; title: string } {
  const item = asRecord(value)
  if (typeof item.chapterUid !== 'number') throw new VaultSyncError('章节缺少 chapterUid')
  return {
    chapterUid: item.chapterUid,
    chapterIdx: typeof item.chapterIdx === 'number' ? item.chapterIdx : 0,
    title: typeof item.title === 'string' ? item.title : '',
  }
}

function readBookId(value: unknown): string {
  const item = asRecord(value)
  if (typeof item.bookId !== 'string') throw new VaultSyncError('笔记本条目缺少 bookId')
  return item.bookId
}

function readNoteCount(value: unknown): number {
  const item = asRecord(value)
  return typeof item.noteCount === 'number' ? item.noteCount : 0
}

function sameClock(incoming: number | null, cursor: ProgressCursor): boolean {
  if (cursor.kind === 'never') return false
  if (incoming == null && cursor.kind === 'missing') return true
  if (incoming != null && cursor.kind === 'time' && cursor.time === incoming) return true
  return false
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object') throw new VaultSyncError('微信读书响应格式不正确')
  return value as Record<string, unknown>
}

function restoreBook(value: unknown): VaultBook | null {
  if (value == null || typeof value !== 'object') return null
  const book = value as Partial<VaultBook>
  if (typeof book.bookId !== 'string' || book.bookId.length === 0) return null
  return {
    bookId: book.bookId,
    title: typeof book.title === 'string' ? book.title : '',
    author: typeof book.author === 'string' ? book.author : '',
    cover: typeof book.cover === 'string' ? book.cover : '',
    readUpdateTime: typeof book.readUpdateTime === 'number' ? book.readUpdateTime : null,
    category: typeof book.category === 'string' && book.category.length > 0 ? book.category : null,
    finishReading: book.finishReading === true,
    progress: typeof book.progress === 'number' ? book.progress : null,
    readingTimeSeconds: typeof book.readingTimeSeconds === 'number' ? book.readingTimeSeconds : null,
    progressCursor: readCursor(book.progressCursor),
    noteCount: typeof book.noteCount === 'number' ? book.noteCount : 0,
    savedNoteCount: typeof book.savedNoteCount === 'number' ? book.savedNoteCount : 0,
    highlightsSynced: book.highlightsSynced === true,
    chapters: Array.isArray(book.chapters) ? book.chapters.flatMap((item) => {
      const chapter = restoreChapter(item)
      return chapter ? [chapter] : []
    }) : [],
    notePath: typeof book.notePath === 'string' && book.notePath.length > 0 ? book.notePath : null,
    noteSignature: typeof book.noteSignature === 'string' ? book.noteSignature : '',
  }
}

function readCursor(value: unknown): ProgressCursor {
  if (value == null || typeof value !== 'object') return { kind: 'never' }
  const cursor = value as { kind?: unknown; time?: unknown }
  if (cursor.kind === 'missing') return { kind: 'missing' }
  if (cursor.kind === 'time' && typeof cursor.time === 'number') return { kind: 'time', time: cursor.time }
  return { kind: 'never' }
}

function restoreChapter(value: unknown): VaultChapter | null {
  if (value == null || typeof value !== 'object') return null
  const chapter = value as Partial<VaultChapter>
  if (typeof chapter.chapterUid !== 'number' || !Array.isArray(chapter.highlights)) return null
  const highlights: VaultHighlight[] = []
  for (const item of chapter.highlights) {
    if (item == null || typeof item !== 'object') return null
    const highlight = item as Partial<VaultHighlight>
    if (typeof highlight.bookmarkId !== 'string' || typeof highlight.markText !== 'string') return null
    highlights.push({ bookmarkId: highlight.bookmarkId, markText: highlight.markText })
  }
  return {
    chapterUid: chapter.chapterUid,
    chapterIdx: typeof chapter.chapterIdx === 'number' ? chapter.chapterIdx : 0,
    title: typeof chapter.title === 'string' ? chapter.title : '',
    highlights,
  }
}

function isGroup(value: unknown): value is VaultGroup {
  if (value == null || typeof value !== 'object') return false
  const group = value as Partial<VaultGroup>
  return typeof group.name === 'string' && Array.isArray(group.bookIds)
}

async function callWithRetry(request: () => Promise<unknown>, attempts = 3): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await request()
    } catch (error) {
      lastError = error
      if (!retryable(error) || attempt === attempts - 1) break
      await delay(400 * (attempt + 1))
    }
  }
  throw lastError
}

function retryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('API Key')) return false
  if (/HTTP 4\d\d/.test(message) && !message.includes('HTTP 429')) return false
  return true
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function eachBook(books: VaultBook[], worker: (book: VaultBook) => Promise<void>) {
  let index = 0
  const runners = Array.from({ length: Math.min(SYNC_CONCURRENCY, books.length) }, async () => {
    while (index < books.length) {
      const current = books[index]
      index += 1
      if (!current) continue
      await worker(current)
    }
  })
  await Promise.all(runners)
}
