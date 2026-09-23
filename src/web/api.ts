import type { BookDetail, BooksResponse, SyncStatus } from '../shared/types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
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
