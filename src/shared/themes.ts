export type ScopeKind = 'category' | 'group' | 'recent'

export const RECENT_SCOPE_KEY = 'recent'
export const RECENT_DAYS = 90

export type ClusterInput = {
  bookmarkId: string
  markText: string
}

export type HighlightCluster = {
  name: string
  bookmarkIds: string[]
}

export type ClusterResult = {
  themes: HighlightCluster[]
  unassigned: string[]
}

export type ThemeScopeOption = {
  kind: ScopeKind
  key: string
  label: string
  bookCount: number
  highlightCount: number
}

export type ThemeSummary = {
  id: string
  name: string
  count: number
}

export type ThemeBoard = {
  kind: ScopeKind
  key: string
  label: string
  bookCount: number
  highlightCount: number
  clustered: boolean
  themes: ThemeSummary[]
  unassignedCount: number
}

export type ThemeHighlightLine = {
  bookmarkId: string
  markText: string
  bookId: string
  title: string
  chapterTitle: string
}

export type ThemeWrite = 'ok' | 'empty' | 'missing' | 'outside' | 'same'

const SIMILARITY = 0.45
const MIN_HAN = 8

export function recentCutoff(now: Date): number {
  return Math.floor(now.getTime() / 1000) - RECENT_DAYS * 24 * 60 * 60
}

export function topCategory(category: string | null | undefined): string {
  const trimmed = category?.trim() ?? ''
  if (!trimmed) return '未分类'
  const head = trimmed.split('-')[0]?.trim()
  return head || '未分类'
}

export function themeNameFromText(markText: string): string {
  const han = hanOf(markText)
  return (han || markText.replace(/\s+/g, ' ').trim()).slice(0, 12) || '未命名'
}

export function clusterHighlights(items: ClusterInput[]): ClusterResult {
  const prepared = items.map((item) => ({ ...item, han: hanOf(item.markText) }))
  const eligible = prepared.filter((item) => item.han.length >= MIN_HAN)
  const unassigned = new Set(prepared.filter((item) => item.han.length < MIN_HAN).map((item) => item.bookmarkId))
  const counts = new Map<string, number>()
  const vectors = new Map<string, Set<string>>()

  for (const item of eligible) {
    const grams = new Set(bigrams(item.han))
    vectors.set(item.bookmarkId, grams)
    for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }

  const stopAt = Math.max(eligible.length / 2, 2)
  for (const [id, grams] of vectors) {
    vectors.set(id, new Set([...grams].filter((gram) => {
      const count = counts.get(gram) ?? 0
      return count > 1 && count <= stopAt
    })))
  }

  type Cluster = { leaderId: string; ids: string[] }
  const clusters: Cluster[] = []
  const ordered = [...eligible].sort((left, right) => left.bookmarkId.localeCompare(right.bookmarkId))
  for (const item of ordered) {
    const vector = vectors.get(item.bookmarkId) ?? new Set<string>()
    if (vector.size === 0) {
      unassigned.add(item.bookmarkId)
      continue
    }
    let best: { cluster: Cluster; score: number } | null = null
    for (const cluster of clusters) {
      const score = cosine(vector, vectors.get(cluster.leaderId) ?? new Set())
      if (!best || score > best.score) best = { cluster, score }
    }
    if (best && best.score >= SIMILARITY) best.cluster.ids.push(item.bookmarkId)
    else clusters.push({ leaderId: item.bookmarkId, ids: [item.bookmarkId] })
  }

  const themes: HighlightCluster[] = []
  for (const cluster of clusters) {
    if (cluster.ids.length < 2) {
      for (const id of cluster.ids) unassigned.add(id)
      continue
    }
    const bookmarkIds = [...cluster.ids].sort((left, right) => left.localeCompare(right))
    themes.push({ name: nameFor(bookmarkIds, vectors), bookmarkIds })
  }
  themes.sort((left, right) => left.bookmarkIds.join('\0').localeCompare(right.bookmarkIds.join('\0')))
  return {
    themes,
    unassigned: [...unassigned].sort((left, right) => left.localeCompare(right)),
  }
}

function nameFor(ids: string[], vectors: Map<string, Set<string>>): string {
  const counts = new Map<string, number>()
  for (const id of ids) {
    for (const term of vectors.get(id) ?? []) counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  const terms = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
    .slice(0, 3)
    .map(([term]) => term)
  return terms.join(' · ') || '未命名'
}

function hanOf(text: string): string {
  return text.replace(/[^\u4e00-\u9fff]/g, '')
}

function bigrams(text: string): string[] {
  const grams: string[] = []
  for (let index = 0; index < text.length - 1; index += 1) grams.push(text.slice(index, index + 2))
  return grams
}

function cosine(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  const [small, large] = left.size < right.size ? [left, right] : [right, left]
  for (const term of small) if (large.has(term)) shared += 1
  return shared / Math.sqrt(left.size * right.size)
}
