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
): Encounter[] {
  const eligible = candidates.filter((item) => isStandaloneSentence(item.markText) && isForgotten(item.readUpdateTime, now))
  const fresh = eligible.filter((item) => !exclude.has(item.bookmarkId))
  const pool = fresh.length >= count || fresh.length === eligible.length ? fresh : [...fresh, ...eligible.filter((item) => exclude.has(item.bookmarkId))]
  const bag = [...pool]
  const chosen: Encounter[] = []
  while (chosen.length < count && bag.length > 0) {
    const index = Math.min(bag.length - 1, Math.floor(random() * bag.length))
    const [item] = bag.splice(index, 1)
    if (!item) break
    chosen.push({
      bookmarkId: item.bookmarkId,
      bookId: item.bookId,
      title: item.title,
      chapterUid: item.chapterUid,
      markText: item.markText.trim(),
    })
  }
  return chosen
}

export function encounterHref(bookId: string, bookmarkId: string): string {
  return `/book/${encodeURIComponent(bookId)}#h=${encodeURIComponent(bookmarkId)}`
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

