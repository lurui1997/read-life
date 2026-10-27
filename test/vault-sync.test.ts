import { describe, expect, it } from 'vitest'
import { wereadReaderUrl } from '../src/shared/weread-url'
import {
  USER_MARK,
  cleanNoteFolder,
  freshNotePath,
  frontmatterBookId,
  highlightBlockId,
  joinNote,
  renderBookNote,
  userSection,
} from '../src/shared/vault-note'
import { emptyCatalog, parseCatalog, syncVaultCatalog, type VaultBook } from '../src/shared/vault-sync'
import { fakeWeread, highlights, localTimestamp, notebookPage, progress, shelfBook } from './helpers'

const chapter = { chapterUid: 108, chapterIdx: 23, title: '15 红岸之四' }

function library(options?: {
  books?: ReturnType<typeof shelfBook>[]
  archive?: Array<{ name: string; bookIds: string[] }>
  notes?: Array<{ bookId: string; noteCount: number; sort: number }>
  notebooks?: (params: Record<string, unknown>) => unknown
}) {
  const books = options?.books ?? [shelfBook({ bookId: '695233', title: '三体', readUpdateTime: localTimestamp(2026), finishReading: true })]
  const notes = options?.notes ?? books.map((book, index) => ({ bookId: book.bookId, noteCount: 1, sort: index + 1 }))
  return fakeWeread({
    '/shelf/sync': () => ({ books, archive: options?.archive ?? [{ name: '在读', bookIds: books.map((book) => book.bookId) }] }),
    '/user/notebooks': (params) => options?.notebooks?.(params) ?? notebookPage(notes),
    '/book/getprogress': () => progress(15, 100),
    '/book/bookmarklist': () => highlights('695233', [{ bookmarkId: '10801', chapterUid: 108, markText: '原文', range: '10-20' }], [chapter]),
  })
}

function sampleBook(): VaultBook {
  return {
    bookId: '695233',
    title: '三体',
    author: '刘慈欣',
    cover: 'https://example.com/cover.jpg',
    readUpdateTime: localTimestamp(2026),
    category: '科幻',
    finishReading: false,
    progress: 15,
    readingTimeSeconds: 100,
    progressCursor: { kind: 'time', time: localTimestamp(2026) },
    noteCount: 1,
    savedNoteCount: 1,
    highlightsSynced: true,
    chapters: [{ chapterUid: 108, chapterIdx: 23, title: '15 红岸之四', highlights: [{ bookmarkId: '10801', markText: '原文一行\n原文二行' }] }],
    notePath: null,
    noteSignature: '',
  }
}

describe('库内同步', () => {
  it('第二次计数和时间都没变时不再请求划线和进度，并留下笔记路径', async () => {
    const first = await syncVaultCatalog(emptyCatalog(), library(), { force: false })
    const book = first.catalog.books[0]
    expect(book?.progress).toBe(100)
    expect(book?.chapters[0]?.highlights[0]?.markText).toBe('原文')
    expect(first.catalog.groups.map((group) => group.name)).toEqual(['在读'])
    const seeded = {
      ...first.catalog,
      books: [{ ...book!, notePath: '折角/三体.md', noteSignature: 'abc' }],
    }
    const secondClient = library()
    const second = await syncVaultCatalog(seeded, secondClient, { force: false })
    expect(secondClient.calls.map((call) => call.apiName)).toEqual(['/shelf/sync', '/user/notebooks'])
    expect(second.catalog.books[0]?.notePath).toBe('折角/三体.md')
    expect(second.catalog.books[0]?.noteSignature).toBe('abc')
    expect(second.skipped).toBe(1)
  })

  it('没有划线的书不请求划线列表', async () => {
    const client = library({ notes: [{ bookId: '695233', noteCount: 0, sort: 1 }] })
    const result = await syncVaultCatalog(emptyCatalog(), client, { force: false })
    expect(client.calls.map((call) => call.apiName)).not.toContain('/book/bookmarklist')
    expect(result.catalog.books[0]?.chapters).toEqual([])
    expect(result.catalog.books[0]?.highlightsSynced).toBe(true)
  })

  it('划线数变化时重新拉取', async () => {
    const first = await syncVaultCatalog(emptyCatalog(), library(), { force: false })
    const client = library({ notes: [{ bookId: '695233', noteCount: 2, sort: 1 }] })
    await syncVaultCatalog(first.catalog, client, { force: false })
    expect(client.calls.map((call) => call.apiName)).toContain('/book/bookmarklist')
  })

  it('笔记本翻页', async () => {
    const books = [shelfBook({ bookId: 'a', title: '甲' }), shelfBook({ bookId: 'b', title: '乙' })]
    const client = library({
      books,
      archive: [],
      notebooks: (params) => params.lastSort
        ? notebookPage([{ bookId: 'b', noteCount: 0, sort: 2 }])
        : notebookPage([{ bookId: 'a', noteCount: 0, sort: 1 }], 1),
    })
    const result = await syncVaultCatalog(emptyCatalog(), client, { force: false })
    expect(result.catalog.books.map((book) => book.bookId)).toEqual(['a', 'b'])
    expect(client.calls.filter((call) => call.apiName === '/user/notebooks')).toHaveLength(2)
  })

  it('索引可以来回读写', async () => {
    const result = await syncVaultCatalog(emptyCatalog(), library(), { force: false })
    const again = parseCatalog(JSON.stringify(result.catalog))
    expect(again.books[0]?.bookId).toBe('695233')
    expect(again.books[0]?.progressCursor).toEqual(result.catalog.books[0]?.progressCursor)
    expect(() => parseCatalog('{')).toThrow('折角索引无法读取')
  })
})

describe('库内笔记', () => {
  it('按章节写成引用，并给划线一个块编号', () => {
    const note = renderBookNote(sampleBook(), ['在读'])
    expect(note).toContain('bookId: "695233"')
    expect(note).toContain('## 15 红岸之四')
    expect(note).toContain('> 原文一行\n> 原文二行\n^h10801')
    expect(note).toContain('进度 15%')
    expect(note).toContain('阅读 2 分钟')
    expect(note).toContain('  - 折角')
    expect(note).toContain(`[在微信读书打开](${wereadReaderUrl('695233')})`)
    expect(highlightBlockId('10801')).toBe('h10801')
    expect(frontmatterBookId(note)).toBe('695233')
  })

  it('标记之后的内容在重写时留下', () => {
    const generated = renderBookNote(sampleBook(), [])
    const saved = joinNote(generated, '我的批注\n')
    expect(saved).toContain(USER_MARK)
    const rewritten = joinNote(generated.replace('进度 15%', '进度 20%'), userSection(saved))
    expect(rewritten).toContain('进度 20%')
    expect(userSection(rewritten)).toBe('我的批注\n')
  })

  it('同名笔记错开文件名，目录去掉越界片段', () => {
    const used = new Set<string>()
    expect(freshNotePath('折角', '三体', '1', used)).toBe('折角/三体.md')
    expect(freshNotePath('折角', '三体', '2', used)).toBe('折角/三体 2.md')
    expect(freshNotePath('折角', 'a/b:c', '3', used)).toBe('折角/a b c.md')
    expect(cleanNoteFolder('../阅读/折角')).toBe('阅读/折角')
    expect(cleanNoteFolder('')).toBe('折角')
  })
})
