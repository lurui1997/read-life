import type { Encounter } from '../shared/encounter'
import type { ScopeKind, ThemeBoard, ThemeHighlightLine, ThemeScopeOption } from '../shared/themes'
import type { MapQuote, MapSourceBook } from '../shared/reading-map'
import type { BookDetail, BooksResponse, SyncStatus } from '../shared/types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (response.status === 401 && !url.startsWith('/api/auth/')) {
    const path = window.location.pathname
    if (path !== '/login' && path !== '/register') window.location.assign('/login')
    throw new Error('请先登录')
  }
  const body = await response.json()
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : '请求失败')
  }
  return body as T
}

export function getKeyStatus() {
  return request<{ configured: boolean }>('/api/key')
}

export function saveKey(apiKey: string) {
  return request<{ configured: boolean }>('/api/key', {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  })
}

export function getSync() {
  return request<SyncStatus>('/api/sync')
}

export function startSync(force: boolean) {
  const query = force ? '?force=1' : ''
  return request<SyncStatus>(`/api/sync${query}`, { method: 'POST' })
}

export function getBooks() {
  return request<BooksResponse>('/api/books')
}

export function getBook(bookId: string) {
  return request<BookDetail>(`/api/books/${encodeURIComponent(bookId)}`)
}

export function getMap() {
  return request<{ books: MapSourceBook[] }>('/api/map')
}

export function getMapQuotes(category: string) {
  const query = new URLSearchParams({ category })
  return request<{ quotes: MapQuote[] }>(`/api/map/quotes?${query}`)
}

export function getEncounter(exclude: string[] = [], count = 3) {
  const params = new URLSearchParams({ count: String(count) })
  if (exclude.length > 0) params.set('exclude', exclude.join(','))
  return request<{ encounters: Encounter[] }>(`/api/encounter?${params}`)
}

export type AuthMe = {
  authRequired: boolean
  user: { id: string; username: string; email: string } | null
  weread: { linked: boolean; wrName: string | null }
}

export function getMe() {
  return request<AuthMe>('/api/auth/me')
}

export function registerAccount(body: { username: string; email: string; password: string }) {
  return request<{ id: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) })
}

export function loginAccount(body: { login: string; password: string }) {
  return request<{ id: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) })
}

export function logoutAccount() {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

export function startWereadLogin() {
  return request<{ loginId: string; qrDataUrl: string }>('/api/weread/login/start', { method: 'POST' })
}

export function pollWereadLogin(loginId: string) {
  return request<{ status: 'pending' | 'done' | 'error'; error?: string; wrName?: string | null }>(
    `/api/weread/login/poll?loginId=${encodeURIComponent(loginId)}`,
  )
}

export function unlinkWeread() {
  return request<{ linked: boolean }>('/api/weread/unlink', { method: 'POST' })
}

export type ShareStatus = {
  enabled: boolean
  path: string | null
}

export function getShare() {
  return request<ShareStatus>('/api/share')
}

export function saveShare(body: { enabled: boolean; rotate?: boolean }) {
  return request<ShareStatus>('/api/share', { method: 'PUT', body: JSON.stringify(body) })
}

export type PublicShelf = BooksResponse & { owner: string }

export function getPublicShelf(token: string) {
  return request<PublicShelf>(`/api/public/shelves/${encodeURIComponent(token)}`)
}

export function getPublicBook(token: string, bookId: string) {
  return request<BookDetail>(`/api/public/shelves/${encodeURIComponent(token)}/books/${encodeURIComponent(bookId)}`)
}

export function getPublicMap(token: string) {
  return request<{ books: MapSourceBook[] }>(`/api/public/shelves/${encodeURIComponent(token)}/map`)
}

export function getPublicMapQuotes(token: string, category: string) {
  const query = new URLSearchParams({ category })
  return request<{ quotes: MapQuote[] }>(`/api/public/shelves/${encodeURIComponent(token)}/map/quotes?${query}`)
}

export function getPublicEncounter(token: string, exclude: string[] = [], count = 3) {
  const params = new URLSearchParams({ count: String(count) })
  if (exclude.length > 0) params.set('exclude', exclude.join(','))
  return request<{ encounters: Encounter[] }>(`/api/public/shelves/${encodeURIComponent(token)}/encounter?${params}`)
}

export function getThemeScopes() {
  return request<{ categories: ThemeScopeOption[]; groups: ThemeScopeOption[]; recent: ThemeScopeOption }>('/api/themes/scopes')
}

export function getThemeBoard(kind: ScopeKind, key: string) {
  const query = new URLSearchParams({ kind, key })
  return request<ThemeBoard>(`/api/themes?${query}`)
}

export function getThemeHighlights(kind: ScopeKind, key: string, theme: string) {
  const query = new URLSearchParams({ kind, key, theme })
  return request<{ highlights: ThemeHighlightLine[] }>(`/api/themes/highlights?${query}`)
}

export function clusterThemes(kind: ScopeKind, key: string) {
  return request<ThemeBoard>('/api/themes/cluster', {
    method: 'POST',
    body: JSON.stringify({ kind, key }),
  })
}

export function renameTheme(themeId: string, name: string) {
  return request<{ ok: boolean }>('/api/themes/rename', {
    method: 'POST',
    body: JSON.stringify({ themeId, name }),
  })
}

export function mergeThemes(sourceId: string, targetId: string) {
  return request<{ ok: boolean }>('/api/themes/merge', {
    method: 'POST',
    body: JSON.stringify({ sourceId, targetId }),
  })
}

export type HandbookChapter = {
  position: number
  title: string
  body: string
  hasImage: boolean
  books: Array<{ bookId: string; title: string; author: string; quotes: string[] }>
}

export type HandbookSummary = {
  id: string
  createdAt: string
  title: string
}

export type HandbookView = {
  modelReady: boolean
  job: {
    running: boolean
    phase: string
    done: number
    total: number
    message: string
    error: string | null
  }
  handbookId: string | null
  history: HandbookSummary[]
  chapters: HandbookChapter[]
}

export function getHandbook(handbookId?: string | null) {
  const query = handbookId ? `?id=${encodeURIComponent(handbookId)}` : ''
  return request<HandbookView>(`/api/handbook${query}`)
}

export function createHandbook() {
  return request<HandbookView>('/api/handbook', { method: 'POST' })
}

export function deleteHandbook(handbookId: string, openId?: string | null) {
  const query = openId ? `?open=${encodeURIComponent(openId)}` : ''
  return request<HandbookView>(`/api/handbook/${encodeURIComponent(handbookId)}${query}`, { method: 'DELETE' })
}

export type HandbookShelfBook = { bookId: string; title: string; author: string }

export function searchHandbookBooks(query: string) {
  const params = new URLSearchParams({ q: query })
  return request<{ books: HandbookShelfBook[] }>(`/api/handbook/books?${params}`)
}

export function writeHandbook(bookIds: string[], rebuildCards = false) {
  return request<HandbookView>('/api/handbook/write', {
    method: 'POST',
    body: JSON.stringify({ bookIds, rebuildCards }),
  })
}

export function saveHandbookChapter(position: number, title: string, body: string, handbookId: string) {
  return request<HandbookView>(`/api/handbook/chapters/${position}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, body, handbookId }),
  })
}

export function rewriteHandbookChapter(position: number, handbookId: string) {
  return request<HandbookView>(`/api/handbook/chapters/${position}/rewrite`, {
    method: 'POST',
    body: JSON.stringify({ handbookId }),
  })
}

export function drawHandbookChapter(position: number, handbookId: string) {
  return request<HandbookView>(`/api/handbook/chapters/${position}/draw`, {
    method: 'POST',
    body: JSON.stringify({ handbookId }),
  })
}

export function moveThemeHighlight(body: {
  kind: ScopeKind
  key: string
  bookmarkId: string
  themeId?: string | null
  create?: boolean
}) {
  return request<ThemeBoard>('/api/themes/move', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
