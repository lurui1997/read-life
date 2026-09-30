const showcaseDismissKey = 'read-life.feature-showcase-dismissed'

export function readShowcaseDismissed(): boolean {
  try {
    return localStorage.getItem(showcaseDismissKey) === '1'
  } catch {
    return false
  }
}

type FeatureShowcaseProps = {
  onDismiss: () => void
  onTrySurprise?: () => void
}

export function FeatureShowcase({ onDismiss, onTrySurprise }: FeatureShowcaseProps) {
  function dismiss() {
    try {
      localStorage.setItem(showcaseDismissKey, '1')
    } catch {
      // ignore
    }
    onDismiss()
  }

  return (
    <section className="guide-strip" aria-label="功能介绍">
      <p>五种看法同一架书。打开惊喜，深处的书也会露面。</p>
      <div className="guide-strip-actions">
        {onTrySurprise ? (
          <button type="button" className="guide-strip-try" onClick={() => { onTrySurprise(); dismiss() }}>
            试试惊喜
          </button>
        ) : null}
        <button type="button" className="guide-strip-close" onClick={dismiss}>
          知道了
        </button>
      </div>
    </section>
  )
}
