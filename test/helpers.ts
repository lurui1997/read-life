import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type AppDatabase } from '../src/server/db'
import type { WereadClient } from '../src/server/weread'

export function tempDb(): AppDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-life-'))
  return openDatabase(path.join(dir, 'test.sqlite'))
}

export function localTimestamp(year: number, month = 6, day = 15, hour = 12): number {
  return Math.floor(new Date(year, month - 1, day, hour).getTime() / 1000)
}

export type Call = { apiName: string; params: Record<string, unknown> }

export function fakeWeread(
  handlers: Record<string, (params: Record<string, unknown>) => unknown>,
): WereadClient & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    async call(apiName, params = {}) {
      calls.push({ apiName, params })
      const handler = handlers[apiName]
      if (!handler) throw new Error(`没有处理 ${apiName}`)
      return handler(params)
    },
  }
}

export function shelfBook(book: {
  bookId: string
  title: string
  author?: string
  cover?: string
  readUpdateTime?: number | null
}) {
  return {
    bookId: book.bookId,
    title: book.title,
    author: book.author ?? '作者',
    cover: book.cover ?? 'https://example.com/cover.jpg',
    readUpdateTime: book.readUpdateTime === undefined ? localTimestamp(2026) : book.readUpdateTime,
  }
}

export function notebookPage(books: Array<{ bookId: string; noteCount: number; sort: number }>, hasMore = 0) {
  return { books, hasMore }
}

export function highlights(bookId: string, items: Array<{ bookmarkId: string; chapterUid: number; markText: string; range?: string | null }>, chapters: Array<{ chapterUid: number; chapterIdx: number; title: string }>) {
  return {
    updated: items.map((item) => ({
      bookId,
      bookmarkId: item.bookmarkId,
      chapterUid: item.chapterUid,
      markText: item.markText,
      range: item.range === undefined ? '1-2' : item.range,
    })),
    chapters,
  }
}

export function progress(percent: number, seconds: number) {
  return { book: { progress: percent, readingTime: seconds } }
}
