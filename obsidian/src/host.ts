import type { App } from 'obsidian'
import type { VaultCatalog } from '../../src/shared/vault-sync'
import type { ReadLifeSettings } from './settings'

export type ShelfMode = 'shelf' | 'encounter'

export interface ReadLifeHost {
  app: App
  settings: ReadLifeSettings
  saveSettings(): Promise<void>
  getCatalog(): Promise<VaultCatalog>
  sync(force?: boolean): Promise<void>
  checkKey(): Promise<void>
  openBook(bookId: string): Promise<void>
  openHighlight(bookId: string, bookmarkId: string): Promise<void>
}
