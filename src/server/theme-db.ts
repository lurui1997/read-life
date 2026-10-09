import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  clusterHighlights,
  recentCutoff,
  themeNameFromText,
  topCategory,
  type ScopeKind,
  type ThemeBoard,
  type ThemeHighlightLine,
  type ThemeScopeOption,
  type ThemeWrite,
} from '../shared/themes'

type ShelfHighlight = ThemeHighlightLine & {
  category: string | null
  readUpdateTime: number | null
}

const SCOPE_LABEL = { category: '分类', group: '分组', recent: '最近读过' } as const

export function createThemeStore(sqlite: Database.Database, uid: (userId?: string) => string) {
  function shelfHighlights(userId: string): ShelfHighlight[] {
    return sqlite.prepare(`
      SELECT h.bookmark_id AS bookmarkId,
             h.mark_text AS markText,
             h.book_id AS bookId,
             b.title AS title,
             COALESCE(c.title, '') AS chapterTitle,
             b.category AS category,
             b.read_update_time AS readUpdateTime
      FROM highlights h
      JOIN books b ON b.user_id = h.user_id AND b.book_id = h.book_id
      LEFT JOIN chapters c
        ON c.user_id = h.user_id AND c.book_id = h.book_id AND c.chapter_uid = h.chapter_uid
      WHERE h.user_id = ? AND b.on_shelf = 1
    `).all(userId) as ShelfHighlight[]
  }

  function groupsByBook(userId: string): Map<string, Set<string>> {
    const rows = sqlite.prepare(`
      SELECT book_id AS bookId, group_name AS groupName
      FROM shelf_group_books WHERE user_id = ?
    `).all(userId) as Array<{ bookId: string; groupName: string }>
    const map = new Map<string, Set<string>>()
    for (const row of rows) {
      const names = map.get(row.bookId) ?? new Set<string>()
      names.add(row.groupName)
      map.set(row.bookId, names)
    }
    return map
  }

  function matches(row: ShelfHighlight, groups: Map<string, Set<string>>, kind: ScopeKind, key: string, now: Date): boolean {
    if (kind === 'category') return topCategory(row.category) === key
    if (kind === 'recent') {
      return row.readUpdateTime != null && row.readUpdateTime >= recentCutoff(now)
    }
    const names = groups.get(row.bookId)
    if (key === '未分组') return !names || names.size === 0
    return names?.has(key) === true
  }

  function scoped(userId: string, kind: ScopeKind, key: string, now: Date): ShelfHighlight[] {
    const groups = groupsByBook(userId)
    return shelfHighlights(userId).filter((row) => matches(row, groups, kind, key, now))
  }

  function scopeLabel(kind: ScopeKind, key: string): string {
    return kind === 'recent' ? SCOPE_LABEL.recent : key
  }

  function clustered(userId: string, kind: ScopeKind, key: string): boolean {
    const row = sqlite.prepare(`
      SELECT 1 AS ok FROM theme_scopes
      WHERE user_id = ? AND scope_kind = ? AND scope_key = ?
    `).get(userId, kind, key) as { ok: number } | undefined
    return Boolean(row)
  }

  function board(userId: string, kind: ScopeKind, key: string, now: Date): ThemeBoard {
    const rows = scoped(userId, kind, key, now)
    const books = new Set(rows.map((row) => row.bookId))
    const ready = clustered(userId, kind, key)
    const inScope = new Set(rows.map((row) => row.bookmarkId))
    const memberships = ready
      ? sqlite.prepare(`
          SELECT th.theme_id AS themeId, th.bookmark_id AS bookmarkId, t.name AS name
          FROM theme_highlights th
          JOIN themes t ON t.user_id = th.user_id AND t.theme_id = th.theme_id
          WHERE th.user_id = ? AND t.scope_kind = ? AND t.scope_key = ?
        `).all(userId, kind, key) as Array<{ themeId: string; bookmarkId: string; name: string }>
      : []
    const counts = new Map<string, { name: string; count: number }>()
    const placed = new Set<string>()
    for (const membership of memberships) {
      const current = counts.get(membership.themeId) ?? { name: membership.name, count: 0 }
      current.name = membership.name
      if (inScope.has(membership.bookmarkId)) {
        current.count += 1
        placed.add(membership.bookmarkId)
      }
      counts.set(membership.themeId, current)
    }
    const visible = [...counts.entries()]
      .map(([id, theme]) => ({ id, name: theme.name, count: theme.count }))
      .filter((theme) => theme.count > 0)
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'))
    return {
      kind,
      key,
      label: scopeLabel(kind, key),
      bookCount: books.size,
      highlightCount: rows.length,
      clustered: ready,
      themes: visible,
      unassignedCount: ready ? rows.filter((row) => !placed.has(row.bookmarkId)).length : 0,
    }
  }

  function lines(userId: string, kind: ScopeKind, key: string, themeId: string, now: Date): ThemeHighlightLine[] {
    const rows = scoped(userId, kind, key, now)
    const allowed = new Set(rows.map((row) => row.bookmarkId))
    const byId = new Map(rows.map((row) => [row.bookmarkId, row]))
    if (themeId === 'unassigned') {
      const placed = new Set((sqlite.prepare(`
        SELECT th.bookmark_id AS bookmarkId
        FROM theme_highlights th
        JOIN themes t ON t.user_id = th.user_id AND t.theme_id = th.theme_id
        WHERE th.user_id = ? AND t.scope_kind = ? AND t.scope_key = ?
      `).all(userId, kind, key) as Array<{ bookmarkId: string }>).map((row) => row.bookmarkId))
      return rows.filter((row) => !placed.has(row.bookmarkId)).map(present)
    }
    const members = sqlite.prepare(`
      SELECT bookmark_id AS bookmarkId FROM theme_highlights
      WHERE user_id = ? AND theme_id = ?
      ORDER BY bookmark_id
    `).all(userId, themeId) as Array<{ bookmarkId: string }>
    return members
      .map((member) => byId.get(member.bookmarkId))
      .filter((row): row is ShelfHighlight => row != null && allowed.has(row.bookmarkId))
      .map(present)
  }

  function replaceScope(userId: string, kind: ScopeKind, key: string, now: Date) {
    const rows = scoped(userId, kind, key, now)
    const result = clusterHighlights(rows.map((row) => ({ bookmarkId: row.bookmarkId, markText: row.markText })))
    const tx = sqlite.transaction(() => {
      const existing = sqlite.prepare(`
        SELECT theme_id AS id FROM themes WHERE user_id = ? AND scope_kind = ? AND scope_key = ?
      `).all(userId, kind, key) as Array<{ id: string }>
      const removeMember = sqlite.prepare('DELETE FROM theme_highlights WHERE user_id = ? AND theme_id = ?')
      for (const theme of existing) removeMember.run(userId, theme.id)
      sqlite.prepare('DELETE FROM themes WHERE user_id = ? AND scope_kind = ? AND scope_key = ?').run(userId, kind, key)
      const insertTheme = sqlite.prepare(`
        INSERT INTO themes (user_id, theme_id, scope_kind, scope_key, name)
        VALUES (?, ?, ?, ?, ?)
      `)
      const insertMember = sqlite.prepare(`
        INSERT INTO theme_highlights (user_id, theme_id, bookmark_id) VALUES (?, ?, ?)
      `)
      for (const theme of result.themes) {
        const id = randomUUID()
        insertTheme.run(userId, id, kind, key, theme.name)
        for (const bookmarkId of theme.bookmarkIds) insertMember.run(userId, id, bookmarkId)
      }
      sqlite.prepare(`
        INSERT INTO theme_scopes (user_id, scope_kind, scope_key, clustered_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, scope_kind, scope_key) DO UPDATE SET clustered_at = excluded.clustered_at
      `).run(userId, kind, key, now.toISOString())
    })
    tx()
  }

  function dropIfEmpty(userId: string, themeId: string) {
    const row = sqlite.prepare(`
      SELECT COUNT(*) AS count FROM theme_highlights WHERE user_id = ? AND theme_id = ?
    `).get(userId, themeId) as { count: number }
    if (row.count === 0) sqlite.prepare('DELETE FROM themes WHERE user_id = ? AND theme_id = ?').run(userId, themeId)
  }

  return {
    listThemeScopes(now: Date, userId?: string): { categories: ThemeScopeOption[]; groups: ThemeScopeOption[]; recent: ThemeScopeOption } {
      const id = uid(userId)
      const rows = shelfHighlights(id)
      const groups = groupsByBook(id)
      const categories = new Map<string, { books: Set<string>; highlights: number }>()
      const groupCounts = new Map<string, { books: Set<string>; highlights: number }>()
      let recentBooks = new Set<string>()
      let recentHighlights = 0
      const cutoff = recentCutoff(now)
      for (const row of rows) {
        const category = topCategory(row.category)
        const bucket = categories.get(category) ?? { books: new Set<string>(), highlights: 0 }
        bucket.books.add(row.bookId)
        bucket.highlights += 1
        categories.set(category, bucket)
        const names = groups.get(row.bookId)
        const groupName = names && names.size > 0 ? [...names] : ['未分组']
        for (const name of groupName) {
          const group = groupCounts.get(name) ?? { books: new Set<string>(), highlights: 0 }
          group.books.add(row.bookId)
          group.highlights += 1
          groupCounts.set(name, group)
        }
        if (row.readUpdateTime != null && row.readUpdateTime >= cutoff) {
          recentBooks.add(row.bookId)
          recentHighlights += 1
        }
      }
      const toOption = (kind: ScopeKind, key: string, books: Set<string>, highlights: number): ThemeScopeOption => ({
        kind,
        key,
        label: scopeLabel(kind, key),
        bookCount: books.size,
        highlightCount: highlights,
      })
      const bySize = (left: ThemeScopeOption, right: ThemeScopeOption) =>
        right.highlightCount - left.highlightCount || left.key.localeCompare(right.key, 'zh-CN')
      return {
        categories: [...categories.entries()]
          .map(([key, bucket]) => toOption('category', key, bucket.books, bucket.highlights))
          .sort(bySize),
        groups: [...groupCounts.entries()]
          .map(([key, bucket]) => toOption('group', key, bucket.books, bucket.highlights))
          .sort(bySize),
        recent: toOption('recent', 'recent', recentBooks, recentHighlights),
      }
    },
    getThemeBoard(kind: ScopeKind, key: string, now: Date, userId?: string): ThemeBoard {
      return board(uid(userId), kind, key, now)
    },
    listThemeHighlights(kind: ScopeKind, key: string, themeId: string, now: Date, userId?: string): ThemeHighlightLine[] {
      return lines(uid(userId), kind, key, themeId, now)
    },
    clusterThemeScope(kind: ScopeKind, key: string, now: Date, userId?: string): ThemeBoard {
      const id = uid(userId)
      replaceScope(id, kind, key, now)
      return board(id, kind, key, now)
    },
    renameTheme(themeId: string, name: string, userId?: string): ThemeWrite {
      const id = uid(userId)
      const cleaned = name.replace(/[\r\n]+/g, ' ').trim().slice(0, 40)
      if (!cleaned) return 'empty'
      const theme = sqlite.prepare('SELECT theme_id FROM themes WHERE user_id = ? AND theme_id = ?').get(id, themeId)
      if (!theme) return 'missing'
      sqlite.prepare('UPDATE themes SET name = ? WHERE user_id = ? AND theme_id = ?').run(cleaned, id, themeId)
      return 'ok'
    },
    mergeThemes(sourceId: string, targetId: string, userId?: string): ThemeWrite {
      const id = uid(userId)
      if (sourceId === targetId) return 'same'
      const themes = sqlite.prepare(`
        SELECT theme_id AS themeId, scope_kind AS kind, scope_key AS key
        FROM themes WHERE user_id = ? AND theme_id IN (?, ?)
      `).all(id, sourceId, targetId) as Array<{ themeId: string; kind: string; key: string }>
      const source = themes.find((theme) => theme.themeId === sourceId)
      const target = themes.find((theme) => theme.themeId === targetId)
      if (!source || !target) return 'missing'
      if (source.kind !== target.kind || source.key !== target.key) return 'outside'
      const tx = sqlite.transaction(() => {
        const members = sqlite.prepare(`
          SELECT bookmark_id AS bookmarkId FROM theme_highlights WHERE user_id = ? AND theme_id = ?
        `).all(id, sourceId) as Array<{ bookmarkId: string }>
        const insert = sqlite.prepare(`
          INSERT OR IGNORE INTO theme_highlights (user_id, theme_id, bookmark_id) VALUES (?, ?, ?)
        `)
        for (const member of members) insert.run(id, targetId, member.bookmarkId)
        sqlite.prepare('DELETE FROM theme_highlights WHERE user_id = ? AND theme_id = ?').run(id, sourceId)
        sqlite.prepare('DELETE FROM themes WHERE user_id = ? AND theme_id = ?').run(id, sourceId)
      })
      tx()
      return 'ok'
    },
    moveThemeHighlight(input: {
      kind: ScopeKind
      key: string
      bookmarkId: string
      themeId: string | null
      create: boolean
      now: Date
    }, userId?: string): ThemeWrite {
      const id = uid(userId)
      const rows = scoped(id, input.kind, input.key, input.now)
      const row = rows.find((item) => item.bookmarkId === input.bookmarkId)
      if (!row) return 'outside'
      if (!input.create && input.themeId) {
        const theme = sqlite.prepare(`
          SELECT theme_id FROM themes
          WHERE user_id = ? AND theme_id = ? AND scope_kind = ? AND scope_key = ?
        `).get(id, input.themeId, input.kind, input.key)
        if (!theme) return 'missing'
      }
      const tx = sqlite.transaction(() => {
        const previous = sqlite.prepare(`
          SELECT th.theme_id AS themeId
          FROM theme_highlights th
          JOIN themes t ON t.user_id = th.user_id AND t.theme_id = th.theme_id
          WHERE th.user_id = ? AND th.bookmark_id = ? AND t.scope_kind = ? AND t.scope_key = ?
        `).all(id, input.bookmarkId, input.kind, input.key) as Array<{ themeId: string }>
        const remove = sqlite.prepare('DELETE FROM theme_highlights WHERE user_id = ? AND theme_id = ? AND bookmark_id = ?')
        for (const item of previous) remove.run(id, item.themeId, input.bookmarkId)
        let nextId = input.themeId
        if (input.create) {
          nextId = randomUUID()
          sqlite.prepare(`
            INSERT INTO themes (user_id, theme_id, scope_kind, scope_key, name) VALUES (?, ?, ?, ?, ?)
          `).run(id, nextId, input.kind, input.key, themeNameFromText(row.markText))
        }
        if (nextId) {
          sqlite.prepare(`
            INSERT OR IGNORE INTO theme_highlights (user_id, theme_id, bookmark_id) VALUES (?, ?, ?)
          `).run(id, nextId, input.bookmarkId)
        }
        for (const item of previous) dropIfEmpty(id, item.themeId)
      })
      tx()
      return 'ok'
    },
  }
}

function present(row: ShelfHighlight): ThemeHighlightLine {
  return {
    bookmarkId: row.bookmarkId,
    markText: row.markText,
    bookId: row.bookId,
    title: row.title,
    chapterTitle: row.chapterTitle,
  }
}
