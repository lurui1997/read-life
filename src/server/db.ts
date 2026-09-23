import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { BookDetail, BookSummary, Highlight, SyncRecord } from '../shared/types'
import { normalizeProgress } from '../shared/progress'
import { wereadReaderUrl } from './weread-url'

export type ProgressCursor =
  | { kind: 'never' }
  | { kind: 'missing' }
  | { kind: 'time'; time: number }

export type StoredBook = {
  bookId: string
  title: string
  author: string
  cover: string
  readUpdateTime: number | null
  onShelf: boolean
  progress: number | null
  readingTimeSeconds: number | null
  progressCursor: ProgressCursor
  highlightsSynced: boolean
  savedNoteCount: number
}

type BookRow = {
  book_id: string
  title: string
  author: string
  cover: string
  read_update_time: number | null
  on_shelf: number
  finish_reading: number
  progress: number | null
  reading_time_seconds: number | null
  progress_state: string
  progress_cursor_time: number | null
  highlights_synced: number
  saved_note_count: number
  highlight_count: number
  category: string | null
  new_rating: number | null
  rating_label: string | null
}

export type AppDatabase = {
  path: string
  getApiKey(): string | null
  setApiKey(apiKey: string): void
  getBook(bookId: string): StoredBook | null
  listStoredBooks(): StoredBook[]
  listOnShelf(): BookSummary[]
  listArchiveGroups(): Array<{ name: string; bookIds: string[] }>
  replaceArchiveGroups(groups: Array<{ name: string; bookIds: string[] }>): void
  listBooksMissingMetadata(): string[]
  setBookMetadata(
    bookId: string,
    metadata: { category: string | null; newRating: number | null; ratingLabel: string | null },
  ): void
  getBookDetail(bookId: string): BookDetail | null
  upsertShelfBook(book: {
    bookId: string
    title: string
    author: string
    cover: string
    readUpdateTime: number | null
    category?: string | null
    finishReading?: boolean
  }): void
  markAbsentOffShelf(presentIds: string[]): void
  setProgress(bookId: string, progress: number, readingTimeSeconds: number, cursor: ProgressCursor): void
  replaceHighlights(
    bookId: string,
    savedNoteCount: number,
    chapters: Array<{ chapterUid: number; chapterIdx: number; title: string }>,
    highlights: Array<{ bookmarkId: string; chapterUid: number; markText: string; range: string | null }>,
  ): void
  insertSync(record: SyncRecord): void
  latestSync(): SyncRecord | null
  close(): void
}

function cursorFromRow(row: BookRow): ProgressCursor {
  if (row.progress_state === 'missing') return { kind: 'missing' }
  if (row.progress_state === 'time' && row.progress_cursor_time != null) {
    return { kind: 'time', time: row.progress_cursor_time }
  }
  return { kind: 'never' }
}

function mapStored(row: BookRow): StoredBook {
  return {
    bookId: row.book_id,
    title: row.title,
    author: row.author,
    cover: row.cover,
    readUpdateTime: row.read_update_time,
    onShelf: row.on_shelf === 1,
    progress: row.progress,
    readingTimeSeconds: row.reading_time_seconds,
    progressCursor: cursorFromRow(row),
    highlightsSynced: row.highlights_synced === 1,
    savedNoteCount: row.saved_note_count,
  }
}

const bookSelect = `
  SELECT b.*,
    (SELECT COUNT(*) FROM highlights h WHERE h.book_id = b.book_id) AS highlight_count
  FROM books b
`

export function openDatabase(filePath: string): AppDatabase {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS books (
      book_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      read_update_time INTEGER,
      on_shelf INTEGER NOT NULL DEFAULT 1,
      progress INTEGER,
      reading_time_seconds INTEGER,
      progress_state TEXT NOT NULL DEFAULT 'never',
      progress_cursor_time INTEGER,
      highlights_synced INTEGER NOT NULL DEFAULT 0,
      saved_note_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chapters (
      book_id TEXT NOT NULL,
      chapter_uid INTEGER NOT NULL,
      chapter_idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY (book_id, chapter_uid)
    );
    CREATE TABLE IF NOT EXISTS highlights (
      bookmark_id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_uid INTEGER NOT NULL,
      mark_text TEXT NOT NULL,
      range TEXT
    );
    CREATE INDEX IF NOT EXISTS highlights_book_id ON highlights (book_id);
    CREATE TABLE IF NOT EXISTS shelf_groups (
      name TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shelf_group_books (
      group_name TEXT NOT NULL,
      book_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (group_name, book_id)
    );
    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      shelf_count INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      skipped INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      message TEXT NOT NULL,
      errors_json TEXT NOT NULL
    );
  `)

  const bookColumns = sqlite.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>
  const names = new Set(bookColumns.map((column) => column.name))
  if (!names.has('category')) sqlite.exec('ALTER TABLE books ADD COLUMN category TEXT')
  if (!names.has('new_rating')) sqlite.exec('ALTER TABLE books ADD COLUMN new_rating INTEGER')
  if (!names.has('rating_label')) sqlite.exec('ALTER TABLE books ADD COLUMN rating_label TEXT')
  if (!names.has('finish_reading')) sqlite.exec('ALTER TABLE books ADD COLUMN finish_reading INTEGER NOT NULL DEFAULT 0')

  const getKeyStmt = sqlite.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
  const setKeyStmt = sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const upsertBook = sqlite.prepare(`
    INSERT INTO books (book_id, title, author, cover, read_update_time, category, finish_reading, on_shelf)
    VALUES (@bookId, @title, @author, @cover, @readUpdateTime, @category, @finishReading, 1)
    ON CONFLICT(book_id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      cover = excluded.cover,
      read_update_time = excluded.read_update_time,
      category = COALESCE(excluded.category, books.category),
      finish_reading = excluded.finish_reading,
      progress = CASE WHEN excluded.finish_reading = 1 THEN 100 ELSE books.progress END,
      on_shelf = 1
  `)
  const markAllOff = sqlite.prepare('UPDATE books SET on_shelf = 0')
  const markOneOn = sqlite.prepare('UPDATE books SET on_shelf = 1 WHERE book_id = ?')
  const setProgressStmt = sqlite.prepare(`
    UPDATE books
    SET progress = @progress,
        reading_time_seconds = @readingTimeSeconds,
        progress_state = @progressState,
        progress_cursor_time = @progressCursorTime
    WHERE book_id = @bookId
  `)
  const deleteHighlights = sqlite.prepare('DELETE FROM highlights WHERE book_id = ?')
  const deleteChapters = sqlite.prepare('DELETE FROM chapters WHERE book_id = ?')
  const insertChapter = sqlite.prepare(`
    INSERT INTO chapters (book_id, chapter_uid, chapter_idx, title)
    VALUES (@bookId, @chapterUid, @chapterIdx, @title)
  `)
  const insertHighlight = sqlite.prepare(`
    INSERT INTO highlights (bookmark_id, book_id, chapter_uid, mark_text, range)
    VALUES (@bookmarkId, @bookId, @chapterUid, @markText, @range)
  `)
  const markHighlightsSynced = sqlite.prepare(`
    UPDATE books
    SET highlights_synced = 1, saved_note_count = ?
    WHERE book_id = ?
  `)
  const insertSyncStmt = sqlite.prepare(`
    INSERT INTO sync_runs (
      started_at, finished_at, shelf_count, updated, skipped, failed, message, errors_json
    ) VALUES (
      @startedAt, @finishedAt, @shelfCount, @updated, @skipped, @failed, @message, @errorsJson
    )
  `)
  const clearArchiveGroupsStmt = sqlite.prepare('DELETE FROM shelf_groups')
  const clearArchiveBooksStmt = sqlite.prepare('DELETE FROM shelf_group_books')
  const insertArchiveGroupStmt = sqlite.prepare('INSERT INTO shelf_groups (name, sort_order) VALUES (?, ?)')
  const insertArchiveBookStmt = sqlite.prepare('INSERT INTO shelf_group_books (group_name, book_id, sort_order) VALUES (?, ?, ?)')
  const setMetadataStmt = sqlite.prepare(`
    UPDATE books
    SET category = CASE WHEN @category IS NOT NULL THEN @category ELSE category END,
        new_rating = CASE WHEN @newRating IS NOT NULL THEN @newRating ELSE new_rating END,
        rating_label = CASE WHEN @ratingLabel IS NOT NULL THEN @ratingLabel ELSE rating_label END
    WHERE book_id = @bookId
  `)
  const latestSyncStmt = sqlite.prepare<[], {
    started_at: string
    finished_at: string
    shelf_count: number
    updated: number
    skipped: number
    failed: number
    message: string
    errors_json: string
  }>('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1')

  const replaceHighlightsTx = sqlite.transaction((
    bookId: string,
    savedNoteCount: number,
    chapters: Array<{ chapterUid: number; chapterIdx: number; title: string }>,
    highlights: Array<{ bookmarkId: string; chapterUid: number; markText: string; range: string | null }>,
  ) => {
    deleteHighlights.run(bookId)
    deleteChapters.run(bookId)
    for (const chapter of chapters) {
      insertChapter.run({ bookId, ...chapter })
    }
    for (const highlight of highlights) {
      insertHighlight.run({ bookId, ...highlight })
    }
    markHighlightsSynced.run(savedNoteCount, bookId)
  })

  function rowById(bookId: string): BookRow | undefined {
    return sqlite.prepare(`${bookSelect} WHERE b.book_id = ?`).get(bookId) as BookRow | undefined
  }

  return {
    path: filePath,
    getApiKey() {
      return getKeyStmt.get('api_key')?.value ?? null
    },
    setApiKey(apiKey: string) {
      setKeyStmt.run('api_key', apiKey)
    },
    getBook(bookId: string) {
      const row = rowById(bookId)
      return row ? mapStored(row) : null
    },
    listStoredBooks() {
      const rows = sqlite.prepare(`${bookSelect} ORDER BY b.book_id`).all() as BookRow[]
      return rows.map(mapStored)
    },
    listOnShelf() {
      const rows = sqlite.prepare(`${bookSelect} WHERE b.on_shelf = 1`).all() as BookRow[]
      return rows.map((row) => ({
        bookId: row.book_id,
        title: row.title,
        author: row.author,
        cover: row.cover,
        readUpdateTime: row.read_update_time,
        progress: normalizeProgress(row.progress, row.finish_reading === 1),
        readingTimeSeconds: row.reading_time_seconds,
        finishReading: row.finish_reading === 1,
        highlightCount: row.highlight_count,
        category: row.category,
        newRating: row.new_rating,
        ratingLabel: row.rating_label,
        wereadUrl: wereadReaderUrl(row.book_id),
      }))
    },
    listArchiveGroups() {
      const groups = sqlite.prepare('SELECT name FROM shelf_groups ORDER BY sort_order').all() as Array<{ name: string }>
      return groups.map((group) => ({
        name: group.name,
        bookIds: (sqlite.prepare(
          'SELECT book_id FROM shelf_group_books WHERE group_name = ? ORDER BY sort_order',
        ).all(group.name) as Array<{ book_id: string }>).map((row) => row.book_id),
      }))
    },
    replaceArchiveGroups(groups) {
      const tx = sqlite.transaction(() => {
        clearArchiveBooksStmt.run()
        clearArchiveGroupsStmt.run()
        groups.forEach((group, groupIndex) => {
          insertArchiveGroupStmt.run(group.name, groupIndex)
          group.bookIds.forEach((bookId, bookIndex) => {
            insertArchiveBookStmt.run(group.name, bookId, bookIndex)
          })
        })
      })
      tx()
    },
    listBooksMissingMetadata() {
      const rows = sqlite.prepare(`
        SELECT book_id FROM books
        WHERE on_shelf = 1 AND new_rating IS NULL
        ORDER BY read_update_time IS NULL, read_update_time DESC, book_id
      `).all() as Array<{ book_id: string }>
      return rows.map((row) => row.book_id)
    },
    setBookMetadata(bookId, metadata) {
      setMetadataStmt.run({
        bookId,
        category: metadata.category,
        newRating: metadata.newRating,
        ratingLabel: metadata.ratingLabel,
      })
    },
    getBookDetail(bookId: string) {
      const row = rowById(bookId)
      if (!row) return null
      const chapters = sqlite.prepare<[string], {
        chapter_uid: number
        chapter_idx: number
        title: string
      }>('SELECT chapter_uid, chapter_idx, title FROM chapters WHERE book_id = ?').all(bookId)
      const highlights = sqlite.prepare<[string], {
        bookmark_id: string
        chapter_uid: number
        mark_text: string
        range: string | null
      }>('SELECT bookmark_id, chapter_uid, mark_text, range FROM highlights WHERE book_id = ?').all(bookId)
      const byChapter = new Map<number, Highlight[]>()
      for (const highlight of highlights) {
        const list = byChapter.get(highlight.chapter_uid) ?? []
        list.push({
          bookmarkId: highlight.bookmark_id,
          markText: highlight.mark_text,
          range: highlight.range,
        })
        byChapter.set(highlight.chapter_uid, list)
      }
      const detailChapters = chapters
        .map((chapter) => ({
          chapterUid: chapter.chapter_uid,
          chapterIdx: chapter.chapter_idx,
          title: chapter.title,
          highlights: (byChapter.get(chapter.chapter_uid) ?? []).sort(compareHighlights),
        }))
        .sort((left, right) => left.chapterIdx - right.chapterIdx || left.chapterUid - right.chapterUid)
      return {
        bookId: row.book_id,
        title: row.title,
        author: row.author,
        cover: row.cover,
        onShelf: row.on_shelf === 1,
        progress: normalizeProgress(row.progress, row.finish_reading === 1),
        readingTimeSeconds: row.reading_time_seconds,
        finishReading: row.finish_reading === 1,
        highlightCount: row.highlight_count,
        wereadUrl: wereadReaderUrl(row.book_id),
        chapters: detailChapters,
      }
    },
    upsertShelfBook(book) {
      upsertBook.run({
        ...book,
        finishReading: book.finishReading ? 1 : 0,
      })
    },
    markAbsentOffShelf(presentIds: string[]) {
      const present = new Set(presentIds)
      const ids = sqlite.prepare('SELECT book_id FROM books').all() as Array<{ book_id: string }>
      const tx = sqlite.transaction(() => {
        markAllOff.run()
        for (const id of ids) {
          if (present.has(id.book_id)) markOneOn.run(id.book_id)
        }
      })
      tx()
    },
    setProgress(bookId, progress, readingTimeSeconds, cursor) {
      setProgressStmt.run({
        bookId,
        progress,
        readingTimeSeconds,
        progressState: cursor.kind === 'never' ? 'never' : cursor.kind,
        progressCursorTime: cursor.kind === 'time' ? cursor.time : null,
      })
    },
    replaceHighlights(bookId, savedNoteCount, chapters, highlights) {
      replaceHighlightsTx(bookId, savedNoteCount, chapters, highlights)
    },
    insertSync(record) {
      insertSyncStmt.run({ ...record, errorsJson: JSON.stringify(record.errors) })
    },
    latestSync() {
      const row = latestSyncStmt.get()
      if (!row) return null
      return {
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        shelfCount: row.shelf_count,
        updated: row.updated,
        skipped: row.skipped,
        failed: row.failed,
        message: row.message,
        errors: JSON.parse(row.errors_json) as SyncRecord['errors'],
      }
    },
    close() {
      sqlite.close()
    },
  }
}

function rangeStart(range: string | null): number | null {
  if (!range) return null
  const head = range.split('-')[0] ?? ''
  if (!/^-?\d+$/.test(head)) return null
  return Number(head)
}

function compareHighlights(left: Highlight, right: Highlight): number {
  const leftStart = rangeStart(left.range)
  const rightStart = rangeStart(right.range)
  if (leftStart == null && rightStart == null) return left.bookmarkId.localeCompare(right.bookmarkId)
  if (leftStart == null) return 1
  if (rightStart == null) return -1
  if (leftStart !== rightStart) return leftStart - rightStart
  return left.bookmarkId.localeCompare(right.bookmarkId)
}
