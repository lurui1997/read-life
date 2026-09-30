import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { isStandaloneSentence, type EncounterCandidate } from '../shared/encounter'
import type { MapQuote, MapSourceBook } from '../shared/reading-map'
import type { BookDetail, BookSummary, Highlight, SyncRecord } from '../shared/types'
import { normalizeProgress } from '../shared/progress'
import { wereadReaderUrl } from './weread-url'
import { openSeal, seal } from './secrets'

export const LOCAL_USER_ID = 'local'

export type UserRecord = {
  id: string
  username: string
  email: string
  passwordHash: string
}

export type WereadLink = {
  linked: boolean
  wrVid: string | null
  wrName: string | null
  apiKey: string | null
  cookies: string | null
}

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
  getApiKey(userId?: string): string | null
  setApiKey(apiKey: string, userId?: string): void
  clearWeread(userId?: string): void
  getWereadLink(userId?: string): WereadLink
  setWereadCookies(userId: string, cookies: string, wrVid: string | null, wrName: string | null): void
  createUser(user: UserRecord): void
  findUserByLogin(login: string): UserRecord | null
  findUserById(id: string): UserRecord | null
  createSession(tokenHash: string, userId: string, expiresAt: string): void
  findSession(tokenHash: string): { userId: string; expiresAt: string } | null
  deleteSession(tokenHash: string): void
  getBook(bookId: string, userId?: string): StoredBook | null
  listStoredBooks(userId?: string): StoredBook[]
  listOnShelf(userId?: string): BookSummary[]
  listArchiveGroups(userId?: string): Array<{ name: string; bookIds: string[] }>
  replaceArchiveGroups(groups: Array<{ name: string; bookIds: string[] }>, userId?: string): void
  listBooksMissingMetadata(userId?: string): string[]
  setBookMetadata(
    bookId: string,
    metadata: { category: string | null; newRating: number | null; ratingLabel: string | null },
    userId?: string,
  ): void
  getBookDetail(bookId: string, userId?: string): BookDetail | null
  listHighlightLines(userId?: string): EncounterCandidate[]
  listMapBooks(userId?: string): MapSourceBook[]
  listMapQuotes(category: string, userId?: string): MapQuote[]
  upsertShelfBook(book: {
    bookId: string
    title: string
    author: string
    cover: string
    readUpdateTime: number | null
    category?: string | null
    finishReading?: boolean
  }, userId?: string): void
  markAbsentOffShelf(presentIds: string[], userId?: string): void
  setProgress(bookId: string, progress: number, readingTimeSeconds: number, cursor: ProgressCursor, userId?: string): void
  replaceHighlights(
    bookId: string,
    savedNoteCount: number,
    chapters: Array<{ chapterUid: number; chapterIdx: number; title: string }>,
    highlights: Array<{ bookmarkId: string; chapterUid: number; markText: string; range: string | null }>,
    userId?: string,
  ): void
  insertSync(record: SyncRecord, userId?: string): void
  latestSync(userId?: string): SyncRecord | null
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
    (SELECT COUNT(*) FROM highlights h WHERE h.user_id = b.user_id AND h.book_id = b.book_id) AS highlight_count
  FROM books b
`

export function openDatabase(filePath: string, secret: string | null = null): AppDatabase {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS weread_accounts (
      user_id TEXT PRIMARY KEY,
      api_key_enc TEXT,
      wr_vid TEXT,
      wr_name TEXT,
      cookies_enc TEXT,
      linked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS books (
      user_id TEXT NOT NULL DEFAULT 'local',
      book_id TEXT NOT NULL,
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
      saved_note_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, book_id)
    );
    CREATE TABLE IF NOT EXISTS chapters (
      user_id TEXT NOT NULL DEFAULT 'local',
      book_id TEXT NOT NULL,
      chapter_uid INTEGER NOT NULL,
      chapter_idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY (user_id, book_id, chapter_uid)
    );
    CREATE TABLE IF NOT EXISTS highlights (
      user_id TEXT NOT NULL DEFAULT 'local',
      bookmark_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      chapter_uid INTEGER NOT NULL,
      mark_text TEXT NOT NULL,
      range TEXT,
      PRIMARY KEY (user_id, bookmark_id)
    );
    CREATE INDEX IF NOT EXISTS highlights_book_id ON highlights (user_id, book_id);
    CREATE TABLE IF NOT EXISTS shelf_groups (
      user_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (user_id, name)
    );
    CREATE TABLE IF NOT EXISTS shelf_group_books (
      user_id TEXT NOT NULL DEFAULT 'local',
      group_name TEXT NOT NULL,
      book_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (user_id, group_name, book_id)
    );
    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'local',
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
  migrateLegacyScope(sqlite)

  const uid = (userId?: string) => userId ?? LOCAL_USER_ID
  const getWereadStmt = sqlite.prepare<[string], {
    api_key_enc: string | null
    wr_vid: string | null
    wr_name: string | null
    cookies_enc: string | null
  }>('SELECT api_key_enc, wr_vid, wr_name, cookies_enc FROM weread_accounts WHERE user_id = ?')
  const upsertWereadKey = sqlite.prepare(`
    INSERT INTO weread_accounts (user_id, api_key_enc, linked_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET api_key_enc = excluded.api_key_enc, linked_at = excluded.linked_at
  `)
  const upsertBook = sqlite.prepare(`
    INSERT INTO books (user_id, book_id, title, author, cover, read_update_time, category, finish_reading, on_shelf)
    VALUES (@userId, @bookId, @title, @author, @cover, @readUpdateTime, @category, @finishReading, 1)
    ON CONFLICT(user_id, book_id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      cover = excluded.cover,
      read_update_time = excluded.read_update_time,
      category = COALESCE(excluded.category, books.category),
      finish_reading = excluded.finish_reading,
      progress = CASE WHEN excluded.finish_reading = 1 THEN 100 ELSE books.progress END,
      on_shelf = 1
  `)
  const markAllOff = sqlite.prepare('UPDATE books SET on_shelf = 0 WHERE user_id = ?')
  const markOneOn = sqlite.prepare('UPDATE books SET on_shelf = 1 WHERE user_id = ? AND book_id = ?')
  const setProgressStmt = sqlite.prepare(`
    UPDATE books
    SET progress = @progress,
        reading_time_seconds = @readingTimeSeconds,
        progress_state = @progressState,
        progress_cursor_time = @progressCursorTime
    WHERE user_id = @userId AND book_id = @bookId
  `)
  const deleteHighlights = sqlite.prepare('DELETE FROM highlights WHERE user_id = ? AND book_id = ?')
  const deleteChapters = sqlite.prepare('DELETE FROM chapters WHERE user_id = ? AND book_id = ?')
  const insertChapter = sqlite.prepare(`
    INSERT INTO chapters (user_id, book_id, chapter_uid, chapter_idx, title)
    VALUES (@userId, @bookId, @chapterUid, @chapterIdx, @title)
  `)
  const insertHighlight = sqlite.prepare(`
    INSERT INTO highlights (user_id, bookmark_id, book_id, chapter_uid, mark_text, range)
    VALUES (@userId, @bookmarkId, @bookId, @chapterUid, @markText, @range)
  `)
  const markHighlightsSynced = sqlite.prepare(`
    UPDATE books
    SET highlights_synced = 1, saved_note_count = ?
    WHERE user_id = ? AND book_id = ?
  `)
  const insertSyncStmt = sqlite.prepare(`
    INSERT INTO sync_runs (
      user_id, started_at, finished_at, shelf_count, updated, skipped, failed, message, errors_json
    ) VALUES (
      @userId, @startedAt, @finishedAt, @shelfCount, @updated, @skipped, @failed, @message, @errorsJson
    )
  `)
  const clearArchiveGroupsStmt = sqlite.prepare('DELETE FROM shelf_groups WHERE user_id = ?')
  const clearArchiveBooksStmt = sqlite.prepare('DELETE FROM shelf_group_books WHERE user_id = ?')
  const insertArchiveGroupStmt = sqlite.prepare('INSERT INTO shelf_groups (user_id, name, sort_order) VALUES (?, ?, ?)')
  const insertArchiveBookStmt = sqlite.prepare('INSERT INTO shelf_group_books (user_id, group_name, book_id, sort_order) VALUES (?, ?, ?, ?)')
  const setMetadataStmt = sqlite.prepare(`
    UPDATE books
    SET category = CASE WHEN @category IS NOT NULL THEN @category ELSE category END,
        new_rating = CASE WHEN @newRating IS NOT NULL THEN @newRating ELSE new_rating END,
        rating_label = CASE WHEN @ratingLabel IS NOT NULL THEN @ratingLabel ELSE rating_label END
    WHERE user_id = @userId AND book_id = @bookId
  `)
  const latestSyncStmt = sqlite.prepare<[string], {
    started_at: string
    finished_at: string
    shelf_count: number
    updated: number
    skipped: number
    failed: number
    message: string
    errors_json: string
  }>('SELECT * FROM sync_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1')

  const replaceHighlightsTx = sqlite.transaction((
    userId: string,
    bookId: string,
    savedNoteCount: number,
    chapters: Array<{ chapterUid: number; chapterIdx: number; title: string }>,
    highlights: Array<{ bookmarkId: string; chapterUid: number; markText: string; range: string | null }>,
  ) => {
    deleteHighlights.run(userId, bookId)
    deleteChapters.run(userId, bookId)
    for (const chapter of chapters) {
      insertChapter.run({ userId, bookId, ...chapter })
    }
    for (const highlight of highlights) {
      insertHighlight.run({ userId, bookId, ...highlight })
    }
    markHighlightsSynced.run(savedNoteCount, userId, bookId)
  })

  function rowById(bookId: string, userId: string): BookRow | undefined {
    return sqlite.prepare(`${bookSelect} WHERE b.user_id = ? AND b.book_id = ?`).get(userId, bookId) as BookRow | undefined
  }

  return {
    path: filePath,
    getApiKey(userId?: string) {
      const row = getWereadStmt.get(uid(userId))
      if (!row?.api_key_enc) return null
      return openSeal(row.api_key_enc, secret)
    },
    setApiKey(apiKey: string, userId?: string) {
      upsertWereadKey.run(uid(userId), seal(apiKey, secret))
    },
    clearWeread(userId?: string) {
      sqlite.prepare('DELETE FROM weread_accounts WHERE user_id = ?').run(uid(userId))
    },
    getWereadLink(userId?: string) {
      const row = getWereadStmt.get(uid(userId))
      return {
        linked: Boolean(row?.api_key_enc),
        wrVid: row?.wr_vid ?? null,
        wrName: row?.wr_name ?? null,
        apiKey: row?.api_key_enc ? openSeal(row.api_key_enc, secret) : null,
        cookies: row?.cookies_enc ? openSeal(row.cookies_enc, secret) : null,
      }
    },
    setWereadCookies(userId, cookies, wrVid, wrName) {
      sqlite.prepare(`
        INSERT INTO weread_accounts (user_id, cookies_enc, wr_vid, wr_name, linked_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          cookies_enc = excluded.cookies_enc,
          wr_vid = excluded.wr_vid,
          wr_name = excluded.wr_name
      `).run(userId, seal(cookies, secret), wrVid, wrName)
    },
    createUser(user) {
      sqlite.prepare('INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
        .run(user.id, user.username, user.email, user.passwordHash)
    },
    findUserByLogin(login) {
      const row = sqlite.prepare<[string, string], { id: string; username: string; email: string; password_hash: string }>(
        'SELECT id, username, email, password_hash FROM users WHERE username = ? OR email = ?',
      ).get(login, login)
      return row ? { id: row.id, username: row.username, email: row.email, passwordHash: row.password_hash } : null
    },
    findUserById(id) {
      const row = sqlite.prepare<[string], { id: string; username: string; email: string; password_hash: string }>(
        'SELECT id, username, email, password_hash FROM users WHERE id = ?',
      ).get(id)
      return row ? { id: row.id, username: row.username, email: row.email, passwordHash: row.password_hash } : null
    },
    createSession(tokenHash, userId, expiresAt) {
      sqlite.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt)
    },
    findSession(tokenHash) {
      return sqlite.prepare<[string], { userId: string; expiresAt: string }>(
        'SELECT user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash = ?',
      ).get(tokenHash) ?? null
    },
    deleteSession(tokenHash) {
      sqlite.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    },
    getBook(bookId: string, userId?: string) {
      const row = rowById(bookId, uid(userId))
      return row ? mapStored(row) : null
    },
    listStoredBooks(userId?: string) {
      const rows = sqlite.prepare(`${bookSelect} WHERE b.user_id = ? ORDER BY b.book_id`).all(uid(userId)) as BookRow[]
      return rows.map(mapStored)
    },
    listOnShelf(userId?: string) {
      const rows = sqlite.prepare(`${bookSelect} WHERE b.user_id = ? AND b.on_shelf = 1`).all(uid(userId)) as BookRow[]
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
      }))
    },
    listArchiveGroups(userId?: string) {
      const id = uid(userId)
      const groups = sqlite.prepare('SELECT name FROM shelf_groups WHERE user_id = ? ORDER BY sort_order').all(id) as Array<{ name: string }>
      return groups.map((group) => ({
        name: group.name,
        bookIds: (sqlite.prepare(
          'SELECT book_id FROM shelf_group_books WHERE user_id = ? AND group_name = ? ORDER BY sort_order',
        ).all(id, group.name) as Array<{ book_id: string }>).map((row) => row.book_id),
      }))
    },
    replaceArchiveGroups(groups, userId?: string) {
      const id = uid(userId)
      const tx = sqlite.transaction(() => {
        clearArchiveBooksStmt.run(id)
        clearArchiveGroupsStmt.run(id)
        groups.forEach((group, groupIndex) => {
          insertArchiveGroupStmt.run(id, group.name, groupIndex)
          group.bookIds.forEach((bookId, bookIndex) => {
            insertArchiveBookStmt.run(id, group.name, bookId, bookIndex)
          })
        })
      })
      tx()
    },
    listBooksMissingMetadata(userId?: string) {
      const rows = sqlite.prepare(`
        SELECT book_id FROM books
        WHERE user_id = ? AND on_shelf = 1 AND new_rating IS NULL
        ORDER BY read_update_time IS NULL, read_update_time DESC, book_id
      `).all(uid(userId)) as Array<{ book_id: string }>
      return rows.map((row) => row.book_id)
    },
    setBookMetadata(bookId, metadata, userId?: string) {
      setMetadataStmt.run({
        userId: uid(userId),
        bookId,
        category: metadata.category,
        newRating: metadata.newRating,
        ratingLabel: metadata.ratingLabel,
      })
    },
    getBookDetail(bookId: string, userId?: string) {
      const id = uid(userId)
      const row = rowById(bookId, id)
      if (!row) return null
      const chapters = sqlite.prepare<[string, string], {
        chapter_uid: number
        chapter_idx: number
        title: string
      }>('SELECT chapter_uid, chapter_idx, title FROM chapters WHERE user_id = ? AND book_id = ?').all(id, bookId)
      const highlights = sqlite.prepare<[string, string], {
        bookmark_id: string
        chapter_uid: number
        mark_text: string
        range: string | null
      }>('SELECT bookmark_id, chapter_uid, mark_text, range FROM highlights WHERE user_id = ? AND book_id = ?').all(id, bookId)
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
    listMapBooks(userId?: string) {
      return sqlite.prepare(`
        SELECT b.book_id AS bookId,
               b.title AS title,
               b.author AS author,
               COALESCE(NULLIF(b.category, ''), '未分类') AS category,
               b.read_update_time AS readUpdateTime,
               COUNT(h.bookmark_id) AS highlightCount
        FROM books b
        LEFT JOIN highlights h ON h.user_id = b.user_id AND h.book_id = b.book_id
        WHERE b.user_id = ?
          AND b.on_shelf = 1
        GROUP BY b.book_id
      `).all(uid(userId)) as MapSourceBook[]
    },
    listMapQuotes(category: string, userId?: string) {
      const rows = sqlite.prepare(`
        SELECT h.bookmark_id AS bookmarkId,
               h.book_id AS bookId,
               b.title AS title,
               h.mark_text AS markText
        FROM highlights h
        JOIN books b ON b.user_id = h.user_id AND b.book_id = h.book_id
        WHERE h.user_id = ?
          AND b.on_shelf = 1
          AND (
            (? = '未分类' AND (b.category IS NULL OR b.category = ''))
            OR b.category = ?
          )
          AND length(h.mark_text) BETWEEN 16 AND 180
        ORDER BY ABS(length(h.mark_text) - 42)
        LIMIT 80
      `).all(uid(userId), category, category) as MapQuote[]
      const standalone = rows.filter((row) => isStandaloneSentence(row.markText))
      return (standalone.length >= 3 ? standalone : rows).slice(0, 8)
    },
    listHighlightLines(userId?: string) {
      const rows = sqlite.prepare<[string], {
        bookmarkId: string
        bookId: string
        title: string
        chapterUid: number
        markText: string
        readUpdateTime: number | null
      }>(`
        SELECT h.bookmark_id AS bookmarkId,
               h.book_id AS bookId,
               b.title AS title,
               h.chapter_uid AS chapterUid,
               h.mark_text AS markText,
               b.read_update_time AS readUpdateTime
        FROM highlights h
        JOIN books b ON b.user_id = h.user_id AND b.book_id = h.book_id
        WHERE h.user_id = ? AND b.on_shelf = 1 AND length(h.mark_text) BETWEEN 12 AND 600
      `).all(uid(userId))
      return rows
    },
    upsertShelfBook(book, userId?: string) {
      upsertBook.run({
        ...book,
        userId: uid(userId),
        finishReading: book.finishReading ? 1 : 0,
      })
    },
    markAbsentOffShelf(presentIds: string[], userId?: string) {
      const id = uid(userId)
      const present = new Set(presentIds)
      const ids = sqlite.prepare('SELECT book_id FROM books WHERE user_id = ?').all(id) as Array<{ book_id: string }>
      const tx = sqlite.transaction(() => {
        markAllOff.run(id)
        for (const row of ids) {
          if (present.has(row.book_id)) markOneOn.run(id, row.book_id)
        }
      })
      tx()
    },
    setProgress(bookId, progress, readingTimeSeconds, cursor, userId?: string) {
      setProgressStmt.run({
        userId: uid(userId),
        bookId,
        progress,
        readingTimeSeconds,
        progressState: cursor.kind === 'never' ? 'never' : cursor.kind,
        progressCursorTime: cursor.kind === 'time' ? cursor.time : null,
      })
    },
    replaceHighlights(bookId, savedNoteCount, chapters, highlights, userId?: string) {
      replaceHighlightsTx(uid(userId), bookId, savedNoteCount, chapters, highlights)
    },
    insertSync(record, userId?: string) {
      insertSyncStmt.run({ ...record, userId: uid(userId), errorsJson: JSON.stringify(record.errors) })
    },
    latestSync(userId?: string) {
      const row = latestSyncStmt.get(uid(userId))
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

function migrateLegacyScope(sqlite: Database.Database) {
  const cols = sqlite.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>
  if (cols.some((column) => column.name === 'user_id')) return
  sqlite.exec(`
    CREATE TABLE books_v2 (
      user_id TEXT NOT NULL DEFAULT 'local',
      book_id TEXT NOT NULL,
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
      saved_note_count INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      new_rating INTEGER,
      rating_label TEXT,
      finish_reading INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, book_id)
    );
    INSERT INTO books_v2 (
      user_id, book_id, title, author, cover, read_update_time, on_shelf, progress,
      reading_time_seconds, progress_state, progress_cursor_time, highlights_synced,
      saved_note_count, category, new_rating, rating_label, finish_reading
    )
    SELECT 'local', book_id, title, author, cover, read_update_time, on_shelf, progress,
      reading_time_seconds, progress_state, progress_cursor_time, highlights_synced,
      saved_note_count, category, new_rating, rating_label, finish_reading
    FROM books;
    DROP TABLE books;
    ALTER TABLE books_v2 RENAME TO books;

    CREATE TABLE chapters_v2 (
      user_id TEXT NOT NULL DEFAULT 'local',
      book_id TEXT NOT NULL,
      chapter_uid INTEGER NOT NULL,
      chapter_idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY (user_id, book_id, chapter_uid)
    );
    INSERT INTO chapters_v2 SELECT 'local', book_id, chapter_uid, chapter_idx, title FROM chapters;
    DROP TABLE chapters;
    ALTER TABLE chapters_v2 RENAME TO chapters;

    CREATE TABLE highlights_v2 (
      user_id TEXT NOT NULL DEFAULT 'local',
      bookmark_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      chapter_uid INTEGER NOT NULL,
      mark_text TEXT NOT NULL,
      range TEXT,
      PRIMARY KEY (user_id, bookmark_id)
    );
    INSERT INTO highlights_v2 SELECT 'local', bookmark_id, book_id, chapter_uid, mark_text, range FROM highlights;
    DROP TABLE highlights;
    ALTER TABLE highlights_v2 RENAME TO highlights;

    CREATE TABLE shelf_groups_v2 (
      user_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (user_id, name)
    );
    INSERT INTO shelf_groups_v2 SELECT 'local', name, sort_order FROM shelf_groups;
    DROP TABLE shelf_groups;
    ALTER TABLE shelf_groups_v2 RENAME TO shelf_groups;

    CREATE TABLE shelf_group_books_v2 (
      user_id TEXT NOT NULL DEFAULT 'local',
      group_name TEXT NOT NULL,
      book_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (user_id, group_name, book_id)
    );
    INSERT INTO shelf_group_books_v2 SELECT 'local', group_name, book_id, sort_order FROM shelf_group_books;
    DROP TABLE shelf_group_books;
    ALTER TABLE shelf_group_books_v2 RENAME TO shelf_group_books;
  `)
  const syncCols = sqlite.prepare('PRAGMA table_info(sync_runs)').all() as Array<{ name: string }>
  if (!syncCols.some((column) => column.name === 'user_id')) {
    sqlite.exec(`ALTER TABLE sync_runs ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'`)
  }
  const legacy = sqlite.prepare("SELECT value FROM settings WHERE key = 'api_key'").get() as { value: string } | undefined
  if (legacy?.value) {
    sqlite.prepare(`
      INSERT INTO weread_accounts (user_id, api_key_enc, linked_at) VALUES ('local', ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET api_key_enc = excluded.api_key_enc
    `).run(legacy.value)
    sqlite.prepare("DELETE FROM settings WHERE key = 'api_key'").run()
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
