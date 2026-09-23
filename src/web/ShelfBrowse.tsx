import { useEffect, useMemo, useState } from 'react'
import { BookCard } from './BookCard'
import { applyRandomOrder, type ShelfSection } from './shelf-views'

type BrowseVariant = 'archive' | 'category'

type ShelfBrowseProps = {
  variant: BrowseVariant
  sections: ShelfSection[]
  totalBooks: number
  storageKey: string
  randomOrder?: boolean
  shuffleSeed?: number
}

export function ShelfBrowse({
  variant,
  sections,
  totalBooks,
  storageKey,
  randomOrder = false,
  shuffleSeed = 0,
}: ShelfBrowseProps) {
  const [selectedKey, setSelectedKey] = useState<string>(() => readStoredKey(storageKey, sections))
  const [query, setQuery] = useState('')
  const [subFilter, setSubFilter] = useState('全部')
  const [visibleCount, setVisibleCount] = useState(36)

  const filteredSections = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sections
    return sections.filter((section) => section.label.toLowerCase().includes(needle))
  }, [query, sections])

  const activeKey = filteredSections.some((section) => section.key === selectedKey)
    ? selectedKey
    : (filteredSections[0]?.key ?? null)

  const activeSection = filteredSections.find((section) => section.key === activeKey) ?? null

  const subFilters = useMemo(() => {
    if (variant !== 'category' || !activeSection) return ['全部']
    const subs = new Set<string>()
    for (const book of activeSection.books) {
      if (!book.category) continue
      const tail = book.category.split('-').slice(1).join('-').trim()
      if (tail) subs.add(tail)
    }
    return ['全部', ...[...subs].sort((left, right) => left.localeCompare(right, 'zh-CN'))]
  }, [activeSection, variant])

  const visibleBooks = useMemo(() => {
    if (!activeSection) return []
    const filtered =
      variant !== 'category' || subFilter === '全部'
        ? activeSection.books
        : activeSection.books.filter((book) => book.category?.includes(subFilter))
    if (!randomOrder) return filtered
    return applyRandomOrder([{ key: activeSection.key, label: activeSection.label, books: filtered }], shuffleSeed)[0]
      ?.books ?? filtered
  }, [activeSection, randomOrder, shuffleSeed, subFilter, variant])

  useEffect(() => {
    if (activeKey) localStorage.setItem(storageKey, activeKey)
  }, [activeKey, storageKey])

  useEffect(() => {
    setSubFilter('全部')
    setVisibleCount(36)
  }, [activeKey, variant])

  if (sections.length === 0) {
    return (
      <div className="browse-empty">
        <p>{variant === 'archive' ? '还没有微信读书分组。' : '还没有分类数据。'}</p>
        <p className="muted">同步完成后会自动出现。</p>
      </div>
    )
  }

  const maxCount = Math.max(...sections.map((section) => section.books.length), 1)
  const shown = visibleBooks.slice(0, visibleCount)

  return (
    <div className={`browse browse-${variant}`}>
      <aside className="browse-nav">
        <div className="browse-nav-head">
          <h2>{variant === 'archive' ? '我的分组' : '书籍分类'}</h2>
          <p className="muted">{filteredSections.length} 个{variant === 'archive' ? '分组' : '分类'}</p>
        </div>
        <label className="browse-search">
          <span className="sr-only">搜索{variant === 'archive' ? '分组' : '分类'}</span>
          <input
            type="search"
            value={query}
            placeholder={variant === 'archive' ? '搜索分组…' : '搜索分类…'}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="browse-nav-list" role="listbox" aria-label={variant === 'archive' ? '分组列表' : '分类列表'}>
          {filteredSections.length === 0 ? (
            <p className="muted browse-nav-empty">没有匹配的{variant === 'archive' ? '分组' : '分类'}。</p>
          ) : null}
          {filteredSections.map((section) => (
            <button
              key={section.key}
              type="button"
              role="option"
              aria-selected={section.key === activeKey}
              className={section.key === activeKey ? 'browse-nav-item active' : 'browse-nav-item'}
              onClick={() => {
                setSelectedKey(section.key)
                setVisibleCount(36)
              }}
            >
              {variant === 'archive' ? <CoverStack books={section.books} /> : null}
              <span className="browse-nav-copy">
                <span className="browse-nav-label">{section.label}</span>
                <span className="browse-nav-meta">{section.books.length} 本</span>
                {variant === 'category' ? (
                  <span className="browse-meter" aria-hidden="true">
                    <span style={{ width: `${(section.books.length / maxCount) * 100}%` }} />
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="browse-main">
        {activeSection ? (
          <>
            <header className="browse-main-head">
              <div>
                <h2>{activeSection.label}</h2>
                <p className="muted">
                  共 {visibleBooks.length} 本
                  {totalBooks > 0 ? ` · 占书架 ${Math.round((activeSection.books.length / totalBooks) * 100)}%` : ''}
                </p>
              </div>
            </header>

            {variant === 'category' && subFilters.length > 1 ? (
              <div className="browse-filters">
                {subFilters.map((label) => (
                  <button
                    key={label}
                    type="button"
                    className={subFilter === label ? 'filter-chip active' : 'filter-chip'}
                    onClick={() => {
                      setSubFilter(label)
                      setVisibleCount(36)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            {shown.length === 0 ? (
              <p className="muted">这个{variant === 'archive' ? '分组' : '分类'}下没有书。</p>
            ) : (
              <div className="grid">
                {shown.map((book) => (
                  <BookCard
                    key={book.bookId}
                    book={book}
                    subtitle={variant === 'category' && book.category ? book.category : null}
                  />
                ))}
              </div>
            )}

            {visibleBooks.length > shown.length ? (
              <button type="button" className="btn-text" onClick={() => setVisibleCount((count) => count + 36)}>
                继续浏览 · 还有 {visibleBooks.length - shown.length} 本
              </button>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  )
}

function CoverStack({ books }: { books: ShelfSection['books'] }) {
  const covers = books.filter((book) => book.cover).slice(0, 3)
  if (covers.length === 0) return <span className="cover-stack cover-stack-empty" aria-hidden="true" />
  return (
    <span className="cover-stack" aria-hidden="true">
      {covers.map((book, index) => (
        <img key={book.bookId} src={book.cover} alt="" style={{ zIndex: covers.length - index }} />
      ))}
    </span>
  )
}

function readStoredKey(storageKey: string, sections: ShelfSection[]): string {
  const saved = localStorage.getItem(storageKey)
  if (saved && sections.some((section) => section.key === saved)) return saved
  return sections[0]?.key ?? ''
}
