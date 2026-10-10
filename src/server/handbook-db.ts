import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { HandbookBookSource, HandbookCard, HandbookChapterDraft, HandbookHighlight } from '../shared/handbook'

export type StoredChapter = HandbookChapterDraft & {
  position: number
  hasImage: boolean
}

export type HandbookSummary = {
  id: string
  createdAt: string
  title: string
}

export function createHandbookStore(sqlite: Database.Database, uid: (userId?: string) => string) {
  migrateHandbooks(sqlite)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS handbook_cards (
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      card TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, book_id)
    );
    CREATE TABLE IF NOT EXISTS handbooks (
      user_id TEXT NOT NULL,
      handbook_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, handbook_id)
    );
    CREATE TABLE IF NOT EXISTS handbook_chapters (
      user_id TEXT NOT NULL,
      handbook_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      has_image INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, handbook_id, position)
    );
    CREATE TABLE IF NOT EXISTS handbook_chapter_books (
      user_id TEXT NOT NULL,
      handbook_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      book_id TEXT NOT NULL,
      PRIMARY KEY (user_id, handbook_id, position, book_id)
    );
  `)

  const listHighlightsStmt = sqlite.prepare(`
    SELECT h.mark_text AS markText, COALESCE(c.title, '') AS chapterTitle
    FROM highlights h
    LEFT JOIN chapters c
      ON c.user_id = h.user_id AND c.book_id = h.book_id AND c.chapter_uid = h.chapter_uid
    WHERE h.user_id = ? AND h.book_id = ?
    ORDER BY COALESCE(c.chapter_idx, 0), h.rowid
  `)

  return {
    searchHandbookShelf(query: string, userId?: string): Array<{ bookId: string; title: string; author: string }> {
      const text = query.trim()
      if (!text) return []
      const like = `%${text.replace(/[%_\\]/g, '')}%`
      return sqlite.prepare(`
        SELECT book_id AS bookId, title, author
        FROM books
        WHERE user_id = ? AND on_shelf = 1 AND (title LIKE ? OR author LIKE ?)
        ORDER BY title
        LIMIT 20
      `).all(uid(userId), like, like) as Array<{ bookId: string; title: string; author: string }>
    },
    listHandbookShelfIds(bookIds: string[], userId?: string): string[] {
      if (bookIds.length === 0) return []
      const marks = bookIds.map(() => '?').join(',')
      const rows = sqlite.prepare(`
        SELECT book_id AS bookId FROM books
        WHERE user_id = ? AND on_shelf = 1 AND book_id IN (${marks})
      `).all(uid(userId), ...bookIds) as Array<{ bookId: string }>
      const present = new Set(rows.map((row) => row.bookId))
      return bookIds.filter((bookId) => present.has(bookId))
    },
    listHandbookBooks(userId: string | undefined, bookIds: string[]): HandbookBookSource[] {
      if (bookIds.length === 0) return []
      const id = uid(userId)
      const marks = bookIds.map(() => '?').join(',')
      const books = sqlite.prepare(`
        SELECT book_id, title, author, category, progress, finish_reading
        FROM books
        WHERE user_id = ? AND on_shelf = 1 AND book_id IN (${marks})
      `).all(id, ...bookIds) as Array<{
        book_id: string
        title: string
        author: string
        category: string | null
        progress: number | null
        finish_reading: number
      }>
      const byId = new Map(books.map((book) => [book.book_id, book]))
      return bookIds.flatMap((bookId) => {
        const book = byId.get(bookId)
        if (!book) return []
        return [{
          bookId: book.book_id,
          title: book.title,
          author: book.author,
          category: book.category,
          progress: book.progress,
          finishReading: book.finish_reading === 1,
          highlights: listHighlightsStmt.all(id, book.book_id) as HandbookHighlight[],
        }]
      })
    },
    listHandbookCards(userId?: string): HandbookCard[] {
      return sqlite.prepare(`
        SELECT book_id AS bookId, title, author, card
        FROM handbook_cards WHERE user_id = ? ORDER BY title
      `).all(uid(userId)) as HandbookCard[]
    },
    saveHandbookCard(card: HandbookCard, userId?: string) {
      sqlite.prepare(`
        INSERT INTO handbook_cards (user_id, book_id, title, author, card, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, book_id) DO UPDATE SET
          title = excluded.title,
          author = excluded.author,
          card = excluded.card,
          updated_at = excluded.updated_at
      `).run(uid(userId), card.bookId, card.title, card.author, card.card)
    },
    clearHandbookCards(userId?: string) {
      sqlite.prepare('DELETE FROM handbook_cards WHERE user_id = ?').run(uid(userId))
    },
    retainHandbookCards(bookIds: string[], userId?: string) {
      const id = uid(userId)
      if (bookIds.length === 0) {
        sqlite.prepare('DELETE FROM handbook_cards WHERE user_id = ?').run(id)
        return
      }
      const marks = bookIds.map(() => '?').join(',')
      sqlite.prepare(`DELETE FROM handbook_cards WHERE user_id = ? AND book_id NOT IN (${marks})`).run(id, ...bookIds)
    },
    listHandbooks(userId?: string): HandbookSummary[] {
      return sqlite.prepare(`
        SELECT h.handbook_id AS id, h.created_at AS createdAt,
          COALESCE((
            SELECT title FROM handbook_chapters c
            WHERE c.user_id = h.user_id AND c.handbook_id = h.handbook_id AND c.position = 1
          ), '') AS title
        FROM handbooks h
        WHERE h.user_id = ?
        ORDER BY h.created_at DESC, h.handbook_id DESC
      `).all(uid(userId)) as HandbookSummary[]
    },
    listHandbookOwners(): Array<{ userId: string; handbookId: string; createdAt: string }> {
      return sqlite.prepare(`
        SELECT user_id AS userId, handbook_id AS handbookId, created_at AS createdAt
        FROM handbooks
        ORDER BY created_at ASC, handbook_id ASC
      `).all() as Array<{ userId: string; handbookId: string; createdAt: string }>
    },
    listHandbookChapters(handbookId: string, userId?: string): StoredChapter[] {
      const id = uid(userId)
      const rows = sqlite.prepare(`
        SELECT position, title, body, has_image AS hasImage
        FROM handbook_chapters
        WHERE user_id = ? AND handbook_id = ?
        ORDER BY position
      `).all(id, handbookId) as Array<{ position: number; title: string; body: string; hasImage: number }>
      const links = sqlite.prepare(`
        SELECT position, book_id AS bookId FROM handbook_chapter_books
        WHERE user_id = ? AND handbook_id = ?
      `).all(id, handbookId) as Array<{ position: number; bookId: string }>
      return rows.map((row) => ({
        position: row.position,
        title: row.title,
        body: row.body,
        hasImage: row.hasImage === 1,
        bookIds: links.filter((link) => link.position === row.position).map((link) => link.bookId),
      }))
    },
    createHandbook(chapters: HandbookChapterDraft[], userId?: string): string {
      const id = uid(userId)
      const handbookId = randomUUID()
      const createdAt = new Date().toISOString()
      const insert = sqlite.prepare(`
        INSERT INTO handbook_chapters (user_id, handbook_id, position, title, body, has_image, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `)
      const link = sqlite.prepare(`
        INSERT INTO handbook_chapter_books (user_id, handbook_id, position, book_id) VALUES (?, ?, ?, ?)
      `)
      const tx = sqlite.transaction(() => {
        sqlite.prepare(`
          INSERT INTO handbooks (user_id, handbook_id, created_at) VALUES (?, ?, ?)
        `).run(id, handbookId, createdAt)
        chapters.forEach((chapter, index) => {
          const position = index + 1
          insert.run(id, handbookId, position, chapter.title, chapter.body, createdAt)
          for (const bookId of chapter.bookIds) link.run(id, handbookId, position, bookId)
        })
      })
      tx()
      return handbookId
    },
    updateHandbookChapter(handbookId: string, position: number, draft: { title: string; body: string }, userId?: string) {
      sqlite.prepare(`
        UPDATE handbook_chapters
        SET title = ?, body = ?, updated_at = ?
        WHERE user_id = ? AND handbook_id = ? AND position = ?
      `).run(draft.title, draft.body, new Date().toISOString(), uid(userId), handbookId, position)
    },
    replaceHandbookChapter(handbookId: string, position: number, draft: HandbookChapterDraft, userId?: string) {
      const id = uid(userId)
      const tx = sqlite.transaction(() => {
        sqlite.prepare(`
          UPDATE handbook_chapters
          SET title = ?, body = ?, updated_at = ?
          WHERE user_id = ? AND handbook_id = ? AND position = ?
        `).run(draft.title, draft.body, new Date().toISOString(), id, handbookId, position)
        sqlite.prepare(`
          DELETE FROM handbook_chapter_books WHERE user_id = ? AND handbook_id = ? AND position = ?
        `).run(id, handbookId, position)
        const link = sqlite.prepare(`
          INSERT INTO handbook_chapter_books (user_id, handbook_id, position, book_id) VALUES (?, ?, ?, ?)
        `)
        for (const bookId of draft.bookIds) link.run(id, handbookId, position, bookId)
      })
      tx()
    },
    markHandbookImage(handbookId: string, position: number, userId?: string) {
      sqlite.prepare(`
        UPDATE handbook_chapters SET has_image = 1, updated_at = ?
        WHERE user_id = ? AND handbook_id = ? AND position = ?
      `).run(new Date().toISOString(), uid(userId), handbookId, position)
    },
    quoteHandbookBook(bookId: string, userId?: string): { title: string; author: string; quotes: string[] } | null {
      const id = uid(userId)
      const book = sqlite.prepare(`
        SELECT title, author FROM books WHERE user_id = ? AND book_id = ? AND on_shelf = 1
      `).get(id, bookId) as { title: string; author: string } | undefined
      if (!book) return null
      const quotes = sqlite.prepare(`
        SELECT mark_text AS markText FROM highlights
        WHERE user_id = ? AND book_id = ? ORDER BY rowid LIMIT 2
      `).all(id, bookId) as Array<{ markText: string }>
      return {
        title: book.title,
        author: book.author,
        quotes: quotes.map((quote) => quote.markText.slice(0, 80)),
      }
    },
  }
}

function migrateHandbooks(sqlite: Database.Database) {
  const table = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'handbook_chapters'
  `).get() as { name: string } | undefined
  if (!table) return
  const columns = sqlite.prepare('PRAGMA table_info(handbook_chapters)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'handbook_id')) return
  const users = sqlite.prepare('SELECT DISTINCT user_id AS userId FROM handbook_chapters').all() as Array<{ userId: string }>
  const run = sqlite.transaction(() => {
  sqlite.exec(`
    ALTER TABLE handbook_chapters RENAME TO handbook_chapters_v1;
    ALTER TABLE handbook_chapter_books RENAME TO handbook_chapter_books_v1;
    CREATE TABLE handbooks (
      user_id TEXT NOT NULL,
      handbook_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, handbook_id)
    );
    CREATE TABLE handbook_chapters (
      user_id TEXT NOT NULL,
      handbook_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      has_image INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, handbook_id, position)
    );
    CREATE TABLE handbook_chapter_books (
      user_id TEXT NOT NULL,
      handbook_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      book_id TEXT NOT NULL,
      PRIMARY KEY (user_id, handbook_id, position, book_id)
    );
  `)
  const insertHandbook = sqlite.prepare(`
    INSERT INTO handbooks (user_id, handbook_id, created_at) VALUES (?, ?, ?)
  `)
  const copyChapters = sqlite.prepare(`
    INSERT INTO handbook_chapters (user_id, handbook_id, position, title, body, has_image, updated_at)
    SELECT user_id, ?, position, title, body, has_image, updated_at
    FROM handbook_chapters_v1 WHERE user_id = ?
  `)
  const copyBooks = sqlite.prepare(`
    INSERT INTO handbook_chapter_books (user_id, handbook_id, position, book_id)
    SELECT user_id, ?, position, book_id
    FROM handbook_chapter_books_v1 WHERE user_id = ?
  `)
  for (const user of users) {
    const handbookId = randomUUID()
    const created = sqlite.prepare(`
      SELECT MIN(updated_at) AS createdAt FROM handbook_chapters_v1 WHERE user_id = ?
    `).get(user.userId) as { createdAt: string | null }
    insertHandbook.run(user.userId, handbookId, created.createdAt ?? new Date().toISOString())
    copyChapters.run(handbookId, user.userId)
    copyBooks.run(handbookId, user.userId)
  }
  sqlite.exec(`
    DROP TABLE handbook_chapters_v1;
    DROP TABLE handbook_chapter_books_v1;
  `)
  })
  run()
}
