import type { Encounter } from '../shared/encounter'
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

export function getEncounter(exclude: string[] = []) {
  const query = exclude.length > 0 ? `?exclude=${encodeURIComponent(exclude.join(','))}` : ''
  return request<{ encounters: Encounter[] }>(`/api/encounter${query}`)
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
