import { useEffect, useRef, useState } from 'react'

type SurpriseToolbarProps = {
  showToggle: boolean
  active: boolean
  shuffleOn: boolean
  onToggle: () => void
  onReshuffle: () => void
}

export function SurpriseToolbar({
  showToggle,
  active,
  shuffleOn,
  onToggle,
  onReshuffle,
}: SurpriseToolbarProps) {
  const [spinning, setSpinning] = useState(false)
  const [justEnabled, setJustEnabled] = useState(false)
  const wasActive = useRef(active)

  useEffect(() => {
    if (!wasActive.current && active) {
      setJustEnabled(true)
      const timer = window.setTimeout(() => setJustEnabled(false), 900)
      wasActive.current = active
      return () => window.clearTimeout(timer)
    }
    wasActive.current = active
    if (!active) setJustEnabled(false)
  }, [active])

  const handleReshuffle = () => {
    setSpinning(true)
    onReshuffle()
    window.setTimeout(() => setSpinning(false), 680)
  }

  if (!showToggle && !shuffleOn) return null

  return (
    <div
      className={[
        'surprise-bar',
        shuffleOn ? 'surprise-bar-on' : '',
        justEnabled ? 'surprise-bar-bloom' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="surprise-spark surprise-spark-a" aria-hidden="true" />
      <span className="surprise-spark surprise-spark-b" aria-hidden="true" />
      <span className="surprise-spark surprise-spark-c" aria-hidden="true" />

      {showToggle ? (
        <button
          type="button"
          className={active ? 'surprise-toggle active' : 'surprise-toggle'}
          aria-pressed={active}
          onClick={onToggle}
        >
          <span className="surprise-icon" aria-hidden="true">
            <SparkleIcon />
          </span>
          <span className="surprise-copy">
            <strong>惊喜模式</strong>
            <span className="surprise-hint">
              {active
                ? '每个分组都已轻轻打乱，深处的书也会露面'
                : '打开后，每个分组都会随机展示'}
            </span>
          </span>
          <span className="surprise-switch" aria-hidden="true">
            <span />
          </span>
        </button>
      ) : (
        <div className="surprise-banner-copy">
          <span className="surprise-icon" aria-hidden="true">
            <SparkleIcon />
          </span>
          <p>
            <strong>惊喜模式已开启</strong>
            <span>慢慢翻，也许会遇见一本久违的书</span>
          </p>
        </div>
      )}

      {shuffleOn ? (
        <button
          type="button"
          className={spinning ? 'surprise-shuffle spinning' : 'surprise-shuffle'}
          onClick={handleReshuffle}
        >
          <span className="surprise-shuffle-icon" aria-hidden="true">
            <ShuffleIcon />
          </span>
          换一个顺序
        </button>
      ) : null}
    </div>
  )
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2.5l1.4 4.6 4.6 1.4-4.6 1.4L12 14.5l-1.4-4.6-4.6-1.4 4.6-1.4L12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M19 8.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" fill="currentColor" opacity="0.55" />
    </svg>
  )
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M16 4h5v5M4 20l6.5-6.5M20 4l-5.5 5.5M4 20l5-5M14 14l6 6M4 4l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
