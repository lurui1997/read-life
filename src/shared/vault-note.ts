import { normalizeProgress } from './progress'
import type { VaultBook } from './vault-sync'
import { highlightCount } from './vault-sync'
import { wereadReaderUrl } from './weread-url'
import { md5 } from './md5'

export const USER_MARK = '%% read-life:user %%'

export function highlightBlockId(bookmarkId: string): string {
  const cleaned = bookmarkId.replace(/[^A-Za-z0-9]/g, '')
  if (cleaned.length > 0 && cleaned.length <= 48 && cleaned === bookmarkId) return `h${cleaned}`
  return `h${cleaned.slice(0, 24)}${md5(bookmarkId).slice(0, 8)}`
}

export function cleanNoteFolder(value: string): string {
  const parts = value
    .split(/[\\/]+/)
    .map((part) => part.trim().replace(/[*:?"<>|#^[\]\u0000-\u001f]/g, ''))
    .filter((part) => part && part !== '.' && part !== '..')
  return parts.join('/') || '折角'
}

export function safeTitle(title: string): string {
  return title
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim()
}

export function freshNotePath(folder: string, title: string, bookId: string, used: Set<string>): string {
  const base = safeTitle(title) || safeBookId(bookId) || '未命名'
  const id = safeBookId(bookId) || 'book'
  const candidates = [`${folder}/${base}.md`, `${folder}/${base} ${id}.md`, `${folder}/${id}.md`]
  for (const candidate of candidates) {
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  const extra = `${folder}/${base} ${id} ${used.size}.md`
  used.add(extra)
  return extra
}

export function frontmatterBookId(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return null
  const line = match[1].split('\n').find((item) => item.startsWith('bookId:'))
  if (!line) return null
  try {
    const value = JSON.parse(line.slice('bookId:'.length).trim()) as unknown
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export function userSection(content: string): string {
  const index = content.indexOf(USER_MARK)
  if (index < 0) return ''
  return content.slice(index + USER_MARK.length).replace(/^\r?\n/, '')
}

export function joinNote(generated: string, user: string): string {
  const body = generated.endsWith('\n') ? generated : `${generated}\n`
  if (!user.trim()) return body
  const tail = user.replace(/^\n+/, '')
  return `${body}\n${USER_MARK}\n${tail.endsWith('\n') ? tail : `${tail}\n`}`
}

export function renderBookNote(book: VaultBook, groups: string[]): string {
  const lines = [frontmatter(book, groups), '', `# ${headingText(book.title, '未命名')}`, '']
  const author = oneLine(book.author)
  if (author) lines.push(author, '')
  const status = statusLine(book, groups)
  if (status) lines.push(status, '')
  for (const chapter of orderedChapters(book)) {
    const highlights = chapter.highlights.filter((item) => item.markText.trim())
    if (highlights.length === 0) continue
    lines.push(`## ${headingText(chapter.title, '未分章')}`, '')
    highlights.forEach((highlight, index) => {
      if (index > 0) lines.push('')
      for (const row of highlight.markText.split('\n')) lines.push(`> ${row}`)
      lines.push(`^${highlightBlockId(highlight.bookmarkId)}`)
    })
    lines.push('')
  }
  lines.push(`[在微信读书打开](${wereadReaderUrl(book.bookId)})`, '')
  return lines.join('\n')
}

export function renderEmptyNote(book: VaultBook, groups: string[]): string {
  return [frontmatter(book, groups), '', `# ${headingText(book.title, '未命名')}`, '', '这本书目前没有划线。', ''].join('\n')
}

function frontmatter(book: VaultBook, groups: string[]): string {
  const progress = normalizeProgress(book.progress, book.finishReading)
  const lines = [
    '---',
    `bookId: ${JSON.stringify(book.bookId)}`,
    `title: ${JSON.stringify(oneLine(book.title))}`,
    `author: ${JSON.stringify(oneLine(book.author))}`,
    `progress: ${progress ?? 'null'}`,
    `finishReading: ${book.finishReading}`,
    `highlightCount: ${highlightCount(book)}`,
  ]
  if (book.category) lines.push(`category: ${JSON.stringify(book.category)}`)
  if (book.readingTimeSeconds != null) lines.push(`readingTime: ${book.readingTimeSeconds}`)
  if (book.cover) lines.push(`cover: ${JSON.stringify(book.cover)}`)
  lines.push(`weread: ${JSON.stringify(wereadReaderUrl(book.bookId))}`)
  if (groups.length > 0) {
    lines.push('groups:')
    for (const group of groups) lines.push(`  - ${JSON.stringify(group)}`)
  }
  lines.push('tags:', '  - 折角', '---')
  return lines.join('\n')
}

function statusLine(book: VaultBook, groups: VaultGroupNames): string {
  const progress = normalizeProgress(book.progress, book.finishReading)
  const parts: string[] = []
  if (book.finishReading || progress === 100) parts.push('已读完')
  else if (progress != null) parts.push(`进度 ${progress}%`)
  if (book.readingTimeSeconds) parts.push(`阅读 ${Math.max(1, Math.round(book.readingTimeSeconds / 60))} 分钟`)
  if (book.category) parts.push(book.category)
  if (groups.length > 0) parts.push(groups.join('、'))
  return parts.join(' · ')
}

type VaultGroupNames = string[]

function orderedChapters(book: VaultBook) {
  return [...book.chapters].sort((left, right) => left.chapterIdx - right.chapterIdx || left.chapterUid - right.chapterUid)
}

function headingText(value: string, fallback: string): string {
  return oneLine(value).replace(/^#+\s*/, '') || fallback
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function safeBookId(bookId: string): string {
  return bookId.replace(/[\\/:*?"<>|#^[\]\s]/g, '').slice(0, 40)
}
