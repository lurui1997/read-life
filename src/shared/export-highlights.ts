import type { BookDetail } from './types'

export function highlightsToMarkdown(book: BookDetail): string {
  const lines = [`# ${oneLine(book.title) || '未命名'}`, '', oneLine(book.author)]
  for (const chapter of book.chapters) {
    if (chapter.highlights.length === 0) continue
    lines.push('', `## ${oneLine(chapter.title) || '未分章'}`, '')
    chapter.highlights.forEach((highlight, index) => {
      if (index > 0) lines.push('')
      for (const row of highlight.markText.split('\n')) lines.push(`> ${row}`)
    })
  }
  return `${lines.join('\n')}\n`
}

export function highlightsToCsv(book: BookDetail): string {
  const rows = ['书名,作者,章节,划线']
  const title = oneLine(book.title)
  const author = oneLine(book.author)
  for (const chapter of book.chapters) {
    const chapterTitle = oneLine(chapter.title)
    for (const highlight of chapter.highlights) {
      rows.push([title, author, chapterTitle, highlight.markText].map(csvField).join(','))
    }
  }
  return `\uFEFF${rows.join('\n')}\n`
}

export function exportFilename(title: string, extension: 'md' | 'csv'): string {
  const cleaned = (oneLine(title) || '未命名').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${cleaned || '未命名'} 划线.${extension}`
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '') || 'highlights'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}
