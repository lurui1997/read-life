import { useEffect, useRef } from 'react'

type LoadMoreSentinelProps = {
  hasMore: boolean
  onLoadMore: () => void
}

export function LoadMoreSentinel({ hasMore, onLoadMore }: LoadMoreSentinelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore

  useEffect(() => {
    if (!hasMore) return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMoreRef.current()
      },
      { rootMargin: '240px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore])

  if (!hasMore) return null
  return <div ref={ref} className="load-sentinel" aria-hidden="true" />
}
