import { formatProgress } from './format'
import type { BookSummary } from '../shared/types'

type BookCardProps = {
  book: BookSummary
  large?: boolean
  subtitle?: string | null
  href?: string
  externalHref?: string
  fresh?: boolean
}

export function BookCard({ book, large = false, subtitle = null, href, externalHref, fresh = false }: BookCardProps) {
  const progress = book.progress ?? 0
  const to = href ?? `/book/${encodeURIComponent(book.bookId)}`
  const external = externalHref ?? `/api/books/${encodeURIComponent(book.bookId)}/weread-redirect`
  const className = [large ? 'card card-large' : 'card', fresh ? 'is-fresh' : ''].filter(Boolean).join(' ')
  return (
    <article className={className}>
      <a className="card-cover" href={to}>
        {book.cover ? <img src={book.cover} alt="" loading="lazy" /> : <div className="cover-fallback" />}
      </a>
      <div className="card-body">
        <h2 className="card-title">
          <a href={to}>{book.title || '未命名'}</a>
        </h2>
        <p className="card-author">{book.author || '未知作者'}</p>
        {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
        {progress > 0 ? (
          <div className="progress-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        ) : null}
        <div className="card-foot">
          <p className="meta">{formatProgress(book.progress, book.finishReading)} · {book.highlightCount} 条划线</p>
          <a
            className="card-external"
            href={external}
            target="_blank"
            rel="noreferrer"
            aria-label="在微信读书打开"
          >
            外读
          </a>
        </div>
      </div>
    </article>
  )
}
