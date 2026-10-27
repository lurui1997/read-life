export type EncounterCandidate = {
  bookmarkId: string
  bookId: string
  title: string
  chapterUid: number
  markText: string
  readUpdateTime: number | null
}

export type Encounter = {
  bookmarkId: string
  bookId: string
  title: string
  chapterUid: number
  markText: string
}

export type ReadingScope = 'all' | 'finished' | 'reading'

export type HighlightLine = EncounterCandidate & {
  finishReading: boolean
  progress: number | null
  category: string | null
}

export type EncounterView = 'flat' | 'group' | 'category'

export type EncounterSection = {
  key: string
  label: string
  bookCount: number
  lineCount: number
  encounters: Encounter[]
}

export function encounterView(raw: string | null | undefined): EncounterView {
  if (raw === 'group' || raw === 'category') return raw
  return 'flat'
}

export function readingScope(raw: string | null | undefined): ReadingScope {
  if (raw === 'finished' || raw === 'reading') return raw
  return 'all'
}

export function inReadingScope(book: { finishReading: boolean; progress: number | null }, scope: ReadingScope): boolean {
  if (scope === 'all') return true
  const finished = book.finishReading || (book.progress ?? 0) >= 100
  if (scope === 'finished') return finished
  return !finished && (book.progress ?? 0) > 0
}

const FORGOTTEN_SECONDS = 90 * 24 * 60 * 60
const CONNECTIVE = /^(但是|所以|因此|因而|于是|然而|不过|而且|并且|同时|此外|另外|接着|然后|从而|上述|对此|也就是说|换句话说|如上所述|与此同时|尽管如此|由此可见|正因为如此|其中|后者|前者)/
const ENGLISH_OPENER = /^(and|but|so|because|however|therefore|then|this|that|it|he|she|they)\b/i

export function isStandaloneSentence(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0 || /[\r\n]/.test(trimmed)) return false
  if (trimmed.includes('…') || trimmed.includes('...')) return false
  if (!quotesBalanced(trimmed)) return false
  const cjk = trimmed.match(/[\u3400-\u9fff]/g)?.length ?? 0
  if (cjk >= 8) return isStandaloneChinese(trimmed)
  if (cjk === 0) return isStandaloneEnglish(trimmed)
  return false
}

export function isForgotten(readUpdateTime: number | null, now: Date): boolean {
  if (readUpdateTime == null || readUpdateTime <= 0) return true
  return readUpdateTime <= Math.floor(now.getTime() / 1000) - FORGOTTEN_SECONDS
}

export function pickEncounters(
  candidates: EncounterCandidate[],
  now: Date,
  count = 3,
  random: () => number = Math.random,
  exclude: ReadonlySet<string> = new Set(),
  forgotten = true,
): Encounter[] {
  const eligible = candidates.filter((item) => isStandaloneSentence(item.markText) && (!forgotten || isForgotten(item.readUpdateTime, now)))
  const fresh = eligible.filter((item) => !exclude.has(item.bookmarkId))
  const used = eligible.filter((item) => exclude.has(item.bookmarkId))
  const seenBooks = new Set<string>()
  const previousBooks = new Set(used.map((item) => item.bookId))
  const chosen: Encounter[] = []

  const unseen = takeBooks(fresh.filter((item) => !previousBooks.has(item.bookId)), count, random, seenBooks)
  chosen.push(...unseen.chosen)
  const seenBefore = takeBooks(fresh.filter((item) => previousBooks.has(item.bookId)), count - chosen.length, random, seenBooks)
  chosen.push(...seenBefore.chosen)
  chosen.push(...drawFrom([...unseen.rest, ...seenBefore.rest], count - chosen.length, random))
  if (chosen.length >= count) return chosen

  const reused = takeBooks(used, count - chosen.length, random, seenBooks)
  chosen.push(...reused.chosen)
  if (chosen.length >= count) return chosen
  return [...chosen, ...drawFrom(reused.rest, count - chosen.length, random)]
}

function takeBooks(
  pool: EncounterCandidate[],
  count: number,
  random: () => number,
  seenBooks: Set<string>,
): { chosen: Encounter[]; rest: EncounterCandidate[] } {
  if (count <= 0 || pool.length === 0) return { chosen: [], rest: pool }
  const byBook = new Map<string, EncounterCandidate[]>()
  const rest: EncounterCandidate[] = []
  for (const item of pool) {
    if (seenBooks.has(item.bookId)) {
      rest.push(item)
      continue
    }
    const lines = byBook.get(item.bookId) ?? []
    lines.push(item)
    byBook.set(item.bookId, lines)
  }
  const chosen: Encounter[] = []
  for (const bookId of shuffle([...byBook.keys()], random)) {
    const lines = byBook.get(bookId) ?? []
    if (chosen.length >= count) {
      rest.push(...lines)
      continue
    }
    const index = Math.min(lines.length - 1, Math.floor(random() * lines.length))
    const item = lines[index]
    if (!item) continue
    seenBooks.add(bookId)
    chosen.push(toEncounter(item))
    rest.push(...lines.filter((_, lineIndex) => lineIndex !== index))
  }
  return { chosen, rest }
}

function drawFrom(pool: EncounterCandidate[], count: number, random: () => number): Encounter[] {
  const bag = [...pool]
  const chosen: Encounter[] = []
  while (chosen.length < count && bag.length > 0) {
    const index = Math.min(bag.length - 1, Math.floor(random() * bag.length))
    const [item] = bag.splice(index, 1)
    if (!item) break
    chosen.push(toEncounter(item))
  }
  return chosen
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.min(index, Math.floor(random() * (index + 1)))
    const current = result[index]!
    result[index] = result[swap]!
    result[swap] = current
  }
  return result
}

function topCategory(category: string | null | undefined): string {
  const trimmed = category?.trim() ?? ''
  if (!trimmed) return '未分类'
  const head = trimmed.split('-')[0]?.trim()
  return head || '未分类'
}

function toEncounter(item: EncounterCandidate): Encounter {
  return {
    bookmarkId: item.bookmarkId,
    bookId: item.bookId,
    title: item.title,
    chapterUid: item.chapterUid,
    markText: item.markText.trim(),
  }
}

export function aggregateEncounters(
  lines: Array<HighlightLine & { groupNames: string[] }>,
  view: Exclude<EncounterView, 'flat'>,
  now: Date,
  count = 3,
  random: () => number = Math.random,
  exclude: ReadonlySet<string> = new Set(),
): EncounterSection[] {
  const buckets = new Map<string, Array<HighlightLine & { groupNames: string[] }>>()
  for (const line of lines) {
    const keys = view === 'category' ? [topCategory(line.category)] : line.groupNames.length > 0 ? line.groupNames : ['未分组']
    for (const key of keys) {
      const bucket = buckets.get(key) ?? []
      bucket.push(line)
      buckets.set(key, bucket)
    }
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: key,
      bookCount: new Set(bucket.map((line) => line.bookId)).size,
      lineCount: bucket.length,
      encounters: pickEncounters(bucket, now, count, random, exclude, false),
    }))
    .sort((left, right) => right.lineCount - left.lineCount || left.label.localeCompare(right.label, 'zh-CN'))
}

export function encounterHref(bookId: string, bookmarkId: string): string {
  return `/book/${encodeURIComponent(bookId)}#h=${encodeURIComponent(bookmarkId)}`
}

export function sharedBookHref(token: string, bookId: string, bookmarkId?: string): string {
  const path = `/s/${encodeURIComponent(token)}/book/${encodeURIComponent(bookId)}`
  return bookmarkId ? `${path}#h=${encodeURIComponent(bookmarkId)}` : path
}

export function bookmarkIdFromHash(hash: string): string | null {
  if (!hash.startsWith('#h=')) return null
  try {
    const bookmarkId = decodeURIComponent(hash.slice(3))
    return bookmarkId.length > 0 ? bookmarkId : null
  } catch {
    return null
  }
}

function quotesBalanced(text: string): boolean {
  const pairs: Array<[string, string]> = [['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’'], ['《', '》']]
  return pairs.every(([open, close]) => depthBalanced(text, open, close)) && (text.match(/"/g) ?? []).length % 2 === 0
}

function depthBalanced(text: string, open: string, close: string): boolean {
  let depth = 0
  for (const char of text) {
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

function isStandaloneChinese(text: string): boolean {
  const length = [...text].length
  if (length < 12 || length > 72) return false
  const core = text.replace(/[」』”"’']+$/u, '')
  if (!/[。！？!?]$/u.test(core)) return false
  if (/[。！？!?]/.test(core.slice(0, -1))) return false
  const spoken = core.replace(/^[「『“"‘']+/u, '')
  return !CONNECTIVE.test(spoken)
}

function isStandaloneEnglish(text: string): boolean {
  if (text.length < 24 || text.length > 180) return false
  if (!/[.!?]$/.test(text)) return false
  if (/[.!?]/.test(text.slice(0, -1))) return false
  return !ENGLISH_OPENER.test(text)
}

