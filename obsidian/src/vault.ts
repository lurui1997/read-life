import { normalizePath, TFile, type Vault } from 'obsidian'
import {
  freshNotePath,
  frontmatterBookId,
  joinNote,
  renderBookNote,
  renderEmptyNote,
  userSection,
} from '../../src/shared/vault-note'
import { md5 } from '../../src/shared/md5'
import {
  emptyCatalog,
  groupMap,
  highlightCount,
  parseCatalog,
  type VaultBook,
  type VaultCatalog,
} from '../../src/shared/vault-sync'

export function pluginCatalogPath(pluginDir: string): string {
  return normalizePath(`${pluginDir}/catalog.json`)
}

export async function loadCatalog(vault: Vault, path: string): Promise<VaultCatalog> {
  const file = normalizePath(path)
  if (!(await vault.adapter.exists(file))) return emptyCatalog()
  return parseCatalog(await vault.adapter.read(file))
}

export async function saveCatalog(vault: Vault, path: string, catalog: VaultCatalog): Promise<void> {
  const file = normalizePath(path)
  const parent = file.split('/').slice(0, -1).join('/')
  if (parent) await ensureFolder(vault, parent)
  await vault.adapter.write(file, JSON.stringify(catalog))
}

export async function applyNotes(
  vault: Vault,
  folder: string,
  catalog: VaultCatalog,
  force = false,
  onProgress?: (done: number, total: number) => void,
): Promise<Array<{ bookId: string; message: string }>> {
  const root = normalizePath(folder)
  await ensureFolder(vault, root)
  const names = groupMap(catalog.groups)
  const used = new Set<string>()
  const errors: Array<{ bookId: string; message: string }> = []
  for (const book of catalog.books) {
    if (book.notePath) used.add(normalizePath(book.notePath))
  }
  for (let index = 0; index < catalog.books.length; index += 1) {
    const book = catalog.books[index]
    if (!book) continue
    try {
      const groups = names.get(book.bookId) ?? []
      if (highlightCount(book) === 0) await clearNote(vault, book, groups)
      else await writeBookNote(vault, root, book, groups, used, force)
    } catch (error) {
      const message = error instanceof Error ? error.message : '笔记写入失败'
      errors.push({ bookId: book.bookId, message })
      console.error('[read-life]', book.bookId, message)
    }
    if (index % 8 === 7) await new Promise((resolve) => window.setTimeout(resolve, 20))
    onProgress?.(index + 1, catalog.books.length)
  }
  return errors
}

async function writeBookNote(vault: Vault, folder: string, book: VaultBook, groups: string[], used: Set<string>, force: boolean) {
  const generated = renderBookNote(book, groups)
  const signature = md5(generated)
  book.notePath = await claimPath(vault, folder, book, used)
  const file = vault.getAbstractFileByPath(book.notePath)
  if (!force && book.noteSignature === signature && file instanceof TFile) return
  const existing = file instanceof TFile ? await vault.read(file) : ''
  await writeVaultFile(vault, book.notePath, joinNote(generated, userSection(existing)))
  book.noteSignature = signature
}

async function writeVaultFile(vault: Vault, path: string, content: string) {
  const current = vault.getAbstractFileByPath(path)
  if (current instanceof TFile) {
    await withTimeout(vault.modify(current, content), 8000, '写入笔记')
    return
  }
  if (current) throw new Error(`${path} 不是笔记文件`)
  try {
    await withTimeout(vault.create(path, content), 8000, '写入笔记')
  } catch (error) {
    const raced = vault.getAbstractFileByPath(path)
    if (raced instanceof TFile) {
      await withTimeout(vault.modify(raced, content), 8000, '写入笔记')
      return
    }
    throw error
  }
}

async function claimPath(vault: Vault, folder: string, book: VaultBook, used: Set<string>): Promise<string> {
  let path = book.notePath ? normalizePath(book.notePath) : ''
  if (!path.startsWith(`${folder}/`)) path = normalizePath(freshNotePath(folder, book.title, book.bookId, used))
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = await readIfPresent(vault, path)
    if (existing == null || frontmatterBookId(existing) === book.bookId) {
      used.add(path)
      return path
    }
    used.add(path)
    path = normalizePath(freshNotePath(folder, book.title, book.bookId, used))
  }
  used.add(path)
  return path
}

async function readIfPresent(vault: Vault, path: string): Promise<string | null> {
  const file = vault.getAbstractFileByPath(path)
  if (file instanceof TFile) return withTimeout(vault.read(file), 8000, '读取笔记')
  const exists = await withTimeout(vault.adapter.exists(path), 8000, '检查笔记')
  if (!exists) return null
  return withTimeout(vault.adapter.read(path), 8000, '读取笔记')
}

async function clearNote(vault: Vault, book: VaultBook, groups: string[]) {
  if (!book.notePath) return
  const path = normalizePath(book.notePath)
  const existing = await readIfPresent(vault, path)
  if (existing == null || frontmatterBookId(existing) !== book.bookId) {
    book.notePath = null
    book.noteSignature = ''
    return
  }
  const user = userSection(existing)
  if (!user.trim()) {
    const file = vault.getAbstractFileByPath(path)
    if (file instanceof TFile) await withTimeout(vault.delete(file), 8000, '删除笔记')
    else await withTimeout(vault.adapter.remove(path), 8000, '删除笔记')
    book.notePath = null
    book.noteSignature = ''
    return
  }
  const generated = renderEmptyNote(book, groups)
  const signature = md5(generated)
  if (signature === book.noteSignature) return
  await writeVaultFile(vault, path, joinNote(generated, user))
  book.noteSignature = signature
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label}超时`)), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function ensureFolder(vault: Vault, folder: string) {
  const parts = normalizePath(folder).split('/').filter((part) => part.length > 0)
  let current = ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    const existing = vault.getAbstractFileByPath(current)
    if (existing instanceof TFile) throw new Error(`${current} 是文件，不能当作笔记目录`)
    if (!existing) await vault.createFolder(current)
  }
}
