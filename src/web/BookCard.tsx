import { formatProgress } from './format'
import type { BookSummary } from '../shared/types'

type BookCardProps = {
  book: BookSummary
  large?: boolean
  subtitle?: string | null
}

export function BookCard({ book, large = false, subtitle = null }: BookCardProps) {
  const progress = book.progress ?? 0
  return (
    <article className={large ? 'card card-large' : 'card'}>
      <a className="card-cover" href={`/book/${encodeURIComponent(book.bookId)}`}>
        {book.cover ? <img src={book.cover} alt="" loading="lazy" /> : <div className="cover-fallback" />}
      </a>
      <div className="card-body">
        <h2 className="card-title">
          <a href={`/book/${encodeURIComponent(book.bookId)}`}>{book.title || '未命名'}</a>
        </h2>
        <p className="card-author">{book.author || '未知作者'}</p>
        {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
        <div className="progress-bar" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }} />
        </div>
        <div className="card-foot">
          <p className="meta">{formatProgress(book.progress, book.finishReading)} · {book.highlightCount} 条划线</p>
          <a className="card-external" href={book.wereadUrl} target="_blank" rel="noreferrer" aria-label="在微信读书打开">
            外读
          </a>
        </div>
      </div>
    </article>
  )
}
