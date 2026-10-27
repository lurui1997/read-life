import { Menu, Notice, Plugin, TFile, normalizePath } from 'obsidian'
import { cleanNoteFolder, highlightBlockId } from '../../src/shared/vault-note'
import { syncVaultCatalog, type VaultCatalog } from '../../src/shared/vault-sync'
import { createGateway } from './gateway'
import type { ReadLifeHost, ShelfMode } from './host'
import { DEFAULT_SETTINGS, type ReadLifeSettings } from './settings'
import { ReadLifeSettingTab } from './setting-tab'
import { applyNotes, loadCatalog, pluginCatalogPath, saveCatalog } from './vault'
import { ReadLifeView, VIEW_TYPE } from './view'

export default class ReadLifePlugin extends Plugin implements ReadLifeHost {
  settings: ReadLifeSettings = { ...DEFAULT_SETTINGS }
  private catalog: VaultCatalog | null = null
  private syncing = false

  async onload() {
    await this.loadSettings()
    this.registerView(VIEW_TYPE, (leaf) => new ReadLifeView(leaf, this))
    this.addSettingTab(new ReadLifeSettingTab(this.app, this))
    this.addRibbon()
    this.addCommand({
      id: 'open-read-life',
      name: '打开折角',
      callback: () => {
        void this.activateView('shelf')
      },
    })
    this.addCommand({
      id: 'open-encounter',
      name: '打开划线',
      callback: () => {
        void this.activateView('encounter')
      },
    })
    this.addCommand({
      id: 'sync-shelf',
      name: '同步书架和划线',
      callback: () => {
        void this.sync(false)
      },
    })
    this.addCommand({
      id: 'force-sync-shelf',
      name: '强制同步书架和划线',
      callback: () => {
        void this.sync(true)
      },
    })
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE)
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  async getCatalog(): Promise<VaultCatalog> {
    if (this.catalog) return this.catalog
    this.catalog = await loadCatalog(this.app.vault, this.catalogFile())
    return this.catalog
  }

  async sync(force = false): Promise<void> {
    if (this.syncing) {
      new Notice('正在同步，请稍等')
      return
    }
    if (!this.settings.apiKey.trim()) {
      new Notice('先在设置里填写微信读书 API Key')
      return
    }
    this.syncing = true
    const notice = new Notice(force ? '正在强制同步…' : '正在同步书架…', 0)
    try {
      const previous = await loadCatalog(this.app.vault, this.catalogFile())
      const result = await syncVaultCatalog(previous, createGateway(this.settings.apiKey), {
        force,
        onProgress: (progress) => {
          if (progress.phase === 'shelf') notice.setMessage('正在读取书架…')
          else if (progress.total === 0 || progress.done === progress.total || progress.done % 20 === 0) {
            notice.setMessage(progress.total === 0 ? '正在读取书架…' : `正在同步 ${progress.done}/${progress.total}`)
          }
        },
      })
      await saveCatalog(this.app.vault, this.catalogFile(), result.catalog)
      const noteErrors = await applyNotes(
        this.app.vault,
        cleanNoteFolder(this.settings.noteFolder),
        result.catalog,
        force,
        (done, total) => {
          if (done === total || done % 20 === 0) notice.setMessage(`正在写笔记 ${done}/${total}`)
        },
      )
      await saveCatalog(this.app.vault, this.catalogFile(), result.catalog)
      this.catalog = result.catalog
      const failed = result.failed + noteErrors.length
      const summary = `更新 ${result.updated}，跳过 ${result.skipped}，失败 ${failed}`
      this.settings.lastSyncAt = result.catalog.updatedAt
      this.settings.lastSyncMessage = summary
      await this.saveSettings()
      const firstError = result.errors[0]?.message ?? noteErrors[0]?.message
      notice.setMessage(firstError ? `${summary}。${firstError}` : `同步完成：${summary}`)
      window.setTimeout(() => notice.hide(), 6000)
      this.refreshViews()
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步失败'
      console.error('[read-life]', error)
      notice.setMessage(message)
      window.setTimeout(() => notice.hide(), 8000)
    } finally {
      this.syncing = false
    }
  }

  async checkKey(): Promise<void> {
    if (!this.settings.apiKey.trim()) {
      new Notice('先填写 API Key')
      return
    }
    try {
      await createGateway(this.settings.apiKey).call('/user/notebooks', { count: 1 })
      new Notice('API Key 可用')
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'API Key 不可用')
    }
  }

  async openBook(bookId: string): Promise<void> {
    const book = (await this.getCatalog()).books.find((item) => item.bookId === bookId)
    if (!book?.notePath) {
      new Notice('这本书还没有划线')
      return
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(book.notePath))
    if (!(file instanceof TFile)) {
      new Notice('没有找到这本书的笔记，再同步一次')
      return
    }
    await this.app.workspace.getLeaf('tab').openFile(file)
  }

  async openHighlight(bookId: string, bookmarkId: string): Promise<void> {
    const book = (await this.getCatalog()).books.find((item) => item.bookId === bookId)
    if (!book?.notePath) {
      new Notice('没有找到这条划线所在的笔记')
      return
    }
    const path = normalizePath(book.notePath)
    await this.app.workspace.openLinkText(`${path}#^${highlightBlockId(bookmarkId)}`, path)
  }

  private async loadSettings() {
    const stored = (await this.loadData()) as Partial<ReadLifeSettings> | null
    this.settings = {
      ...DEFAULT_SETTINGS,
      apiKey: typeof stored?.apiKey === 'string' ? stored.apiKey : '',
      wrName: typeof stored?.wrName === 'string' && stored.wrName.trim() ? stored.wrName : null,
      noteFolder: typeof stored?.noteFolder === 'string' && stored.noteFolder.trim() ? stored.noteFolder : DEFAULT_SETTINGS.noteFolder,
      lastSyncAt: typeof stored?.lastSyncAt === 'string' ? stored.lastSyncAt : null,
      lastSyncMessage: typeof stored?.lastSyncMessage === 'string' ? stored.lastSyncMessage : '',
    }
  }

  private catalogFile(): string {
    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`
    return pluginCatalogPath(dir)
  }

  private refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view
      if (view instanceof ReadLifeView) void view.reload()
    }
  }

  private async activateView(mode: ShelfMode) {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)
    const leaf = existing[0]
    if (leaf) {
      this.app.workspace.revealLeaf(leaf)
      const view = leaf.view
      if (view instanceof ReadLifeView) await view.show(mode)
      return
    }
    const next = this.app.workspace.getLeaf('tab')
    await next.setViewState({ type: VIEW_TYPE, active: true, state: { mode } })
    this.app.workspace.revealLeaf(next)
  }

  private addRibbon() {
    const ribbon = this.addRibbonIcon('book-open', '折角', () => {
      void this.activateView('shelf')
    })
    ribbon.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const preventDefaultMouseDown = (mouseDownEvent: MouseEvent) => {
        mouseDownEvent.preventDefault()
      }
      window.addEventListener('mousedown', preventDefaultMouseDown)
      const menu = new Menu()
      menu.addItem((item) =>
        item
          .setTitle('同步书架和划线')
          .setIcon('refresh-ccw')
          .onClick(() => {
            void this.sync(false)
          }),
      )
      menu.addItem((item) =>
        item
          .setTitle('强制同步')
          .setIcon('refresh-ccw')
          .onClick(() => {
            void this.sync(true)
          }),
      )
      menu.addItem((item) =>
        item
          .setTitle('划线')
          .setIcon('quote')
          .onClick(() => {
            void this.activateView('encounter')
          }),
      )
      menu.showAtMouseEvent(event)
      menu.onHide(() => {
        window.removeEventListener('mousedown', preventDefaultMouseDown)
      })
    })
  }
}
