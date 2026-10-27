import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import { pickEncounters, type Encounter, type EncounterCandidate } from '../../src/shared/encounter'
import { normalizeProgress } from '../../src/shared/progress'
import { groupMap, highlightCount, type VaultBook, type VaultCatalog } from '../../src/shared/vault-sync'
import type { ReadLifeHost, ShelfMode } from './host'

export const VIEW_TYPE = 'read-life'

export class ReadLifeView extends ItemView {
  private readonly host: ReadLifeHost
  private mode: ShelfMode = 'shelf'
  private catalog: VaultCatalog | null = null
  private query = ''
  private includeRecent = false
  private readonly exclude = new Set<string>()
  private drawn: Encounter[] = []
  private cachedCandidates: EncounterCandidate[] | null = null
  private ready = false
  private meta: HTMLElement | null = null
  private tabs: HTMLElement | null = null
  private search: HTMLInputElement | null = null
  private list: HTMLElement | null = null

  constructor(leaf: WorkspaceLeaf, host: ReadLifeHost) {
    super(leaf)
    this.host = host
    this.navigation = true
  }

  getViewType(): string {
    return VIEW_TYPE
  }

  getDisplayText(): string {
    return '折角'
  }

  getIcon(): string {
    return 'book-open'
  }

  getState(): { mode: ShelfMode } {
    return { mode: this.mode }
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result)
    const mode = state && typeof state === 'object' && 'mode' in state ? (state as { mode?: string }).mode : undefined
    if (mode === 'encounter' || mode === 'shelf') this.mode = mode
    if (this.ready) {
      this.paintChrome()
      this.paintList()
    }
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl
    root.empty()
    root.addClass('read-life')
    const head = root.createDiv({ cls: 'read-life-head' })
    head.createEl('h2', { text: '折角' })
    this.meta = head.createEl('p', { cls: 'read-life-meta' })
    const actions = head.createDiv({ cls: 'read-life-actions' })
    const sync = actions.createEl('button', { text: '同步', cls: 'is-active' })
    sync.type = 'button'
    sync.addEventListener('click', () => {
      void this.host.sync(false)
    })
    this.tabs = root.createDiv({ cls: 'read-life-tabs' })
    this.search = root.createEl('input', { cls: 'read-life-search' })
    this.search.type = 'search'
    this.search.placeholder = '搜索书名或作者'
    this.search.addEventListener('input', () => {
      this.query = this.search?.value.trim() ?? ''
      this.paintList()
    })
    this.list = root.createDiv({ cls: 'read-life-list' })
    this.ready = true
    await this.reload()
  }

  async onClose(): Promise<void> {
    this.ready = false
  }

  async show(mode: ShelfMode): Promise<void> {
    this.mode = mode
    if (!this.ready) return
    this.paintChrome()
    this.paintList()
  }

  async reload(): Promise<void> {
    this.cachedCandidates = null
    this.exclude.clear()
    this.drawn = []
    this.includeRecent = false
    try {
      this.catalog = await this.host.getCatalog()
    } catch (error) {
      this.catalog = null
      this.meta?.setText(error instanceof Error ? error.message : '索引读不出来')
      this.list?.empty()
      return
    }
    this.paintChrome()
    this.paintList()
  }

  private paintChrome() {
    if (!this.meta || !this.tabs) return
    const books = this.catalog?.books.length ?? 0
    const lines = this.catalog?.books.reduce((sum, book) => sum + highlightCount(book), 0) ?? 0
    const sync = this.host.settings.lastSyncMessage
    this.meta.setText(sync ? `${books} 本 · ${lines} 条划线 · ${sync}` : `${books} 本 · ${lines} 条划线`)
    this.tabs.empty()
    for (const tab of [
      { id: 'shelf' as const, label: '书架' },
      { id: 'encounter' as const, label: '划线' },
    ]) {
      const button = this.tabs.createEl('button', { text: tab.label })
      button.type = 'button'
      if (tab.id === this.mode) button.addClass('is-active')
      button.addEventListener('click', () => {
        void this.show(tab.id)
      })
    }
    if (this.search) this.search.style.display = this.mode === 'shelf' ? '' : 'none'
  }

  private paintList() {
    if (!this.list) return
    this.list.empty()
    if (!this.catalog) return
    if (!this.host.settings.lastSyncAt) {
      this.list.createEl('p', { text: '还没有同步。填写 API Key 后点上面的同步。', cls: 'read-life-empty' })
      return
    }
    if (this.mode === 'encounter') this.paintEncounter(this.list)
    else this.paintShelf(this.list)
  }

  private paintShelf(list: HTMLElement) {
    const catalog = this.catalog
    if (!catalog || catalog.books.length === 0) {
      list.createEl('p', { text: '书架是空的。', cls: 'read-life-empty' })
      return
    }
    const needle = this.query.toLowerCase()
    if (needle) {
      const found = catalog.books.filter((book) => `${book.title}\n${book.author}`.toLowerCase().includes(needle))
      if (found.length === 0) {
        list.createEl('p', { text: '没有找到。', cls: 'read-life-empty' })
        return
      }
      for (const book of found.slice(0, 80)) appendBook(list, book, this.host)
      if (found.length > 80) list.createEl('p', { text: '还有更多，把关键词写得更具体些。', cls: 'read-life-empty' })
      return
    }
    for (const section of shelfSections(catalog)) {
      const details = list.createEl('details')
      details.createEl('summary', { text: `${section.name} · ${section.books.length}` })
      details.addEventListener('toggle', () => {
        if (!details.open || details.dataset.ready === '1') return
        details.dataset.ready = '1'
        for (const book of section.books) appendBook(details, book, this.host)
      })
    }
  }

  private paintEncounter(list: HTMLElement) {
    if (this.drawn.length === 0) this.draw(false)
    if (this.drawn.length === 0) {
      list.createEl('p', { text: '这里还没有可以单独成句的划线。', cls: 'read-life-empty' })
      if (!this.includeRecent) {
        const more = list.createEl('button', { text: '包括最近读过的' })
        more.type = 'button'
        more.addEventListener('click', () => {
          this.includeRecent = true
          this.exclude.clear()
          this.drawn = []
          this.paintList()
        })
      }
      return
    }
    const refresh = list.createEl('button', { text: '换一批', cls: 'is-active' })
    refresh.type = 'button'
    refresh.addEventListener('click', () => {
      this.drawn = []
      this.paintList()
    })
    for (const item of this.drawn) {
      const card = list.createEl('button', { cls: 'read-life-card' })
      card.type = 'button'
      card.createEl('p', { text: item.markText, cls: 'read-life-quote' })
      card.createEl('p', { text: item.title, cls: 'read-life-by' })
      card.addEventListener('click', () => {
        void this.host.openHighlight(item.bookId, item.bookmarkId)
      })
    }
  }

  private draw(reset: boolean) {
    if (reset) this.exclude.clear()
    const picked = pickEncounters(this.candidates(), new Date(), 3, Math.random, this.exclude, !this.includeRecent)
    for (const item of picked) this.exclude.add(item.bookmarkId)
    this.drawn = picked
  }

  private candidates(): EncounterCandidate[] {
    if (this.cachedCandidates) return this.cachedCandidates
    const list: EncounterCandidate[] = []
    for (const book of this.catalog?.books ?? []) {
      for (const chapter of book.chapters) {
        for (const highlight of chapter.highlights) {
          list.push({
            bookmarkId: highlight.bookmarkId,
            bookId: book.bookId,
            title: book.title,
            chapterUid: chapter.chapterUid,
            markText: highlight.markText,
            readUpdateTime: book.readUpdateTime,
          })
        }
      }
    }
    this.cachedCandidates = list
    return list
  }
}

function shelfSections(catalog: VaultCatalog): Array<{ name: string; books: VaultBook[] }> {
  const byId = new Map(catalog.books.map((book) => [book.bookId, book]))
  const grouped = new Set<string>()
  const sections: Array<{ name: string; books: VaultBook[] }> = []
  for (const group of catalog.groups) {
    const books = group.bookIds.flatMap((bookId) => {
      const book = byId.get(bookId)
      return book ? [book] : []
    })
    for (const book of books) grouped.add(book.bookId)
    if (books.length > 0) sections.push({ name: group.name, books: sortBooks(books) })
  }
  const names = groupMap(catalog.groups)
  const rest = catalog.books.filter((book) => !names.has(book.bookId) && !grouped.has(book.bookId))
  if (rest.length > 0) sections.push({ name: sections.length > 0 ? '未分组' : '书架', books: sortBooks(rest) })
  return sections
}

function sortBooks(books: VaultBook[]): VaultBook[] {
  return [...books].sort((left, right) => (right.readUpdateTime ?? 0) - (left.readUpdateTime ?? 0) || left.title.localeCompare(right.title, 'zh-CN'))
}

function appendBook(parent: HTMLElement, book: VaultBook, host: ReadLifeHost) {
  const row = parent.createEl('button', { cls: 'read-life-book' })
  row.type = 'button'
  row.createEl('span', { text: book.title || '未命名', cls: 'read-life-title' })
  const progress = normalizeProgress(book.progress, book.finishReading)
  const bits = [book.author]
  if (book.finishReading || progress === 100) bits.push('已读完')
  else if (progress != null && progress > 0) bits.push(`${progress}%`)
  else bits.push('未读')
  const count = highlightCount(book)
  if (count > 0) bits.push(`${count} 条划线`)
  row.createEl('span', { text: bits.filter((bit) => bit.length > 0).join(' · '), cls: 'read-life-by' })
  row.addEventListener('click', () => {
    void host.openBook(book.bookId)
  })
}
