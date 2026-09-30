import { useState } from 'react'

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

  const handleReshuffle = () => {
    setSpinning(true)
    onReshuffle()
    window.setTimeout(() => setSpinning(false), 680)
  }

  if (!showToggle && !shuffleOn) return null

  return (
    <div className={shuffleOn ? 'surprise-inline on' : 'surprise-inline'}>
      {showToggle ? (
        <button
          type="button"
          className={active ? 'surprise-inline-toggle on' : 'surprise-inline-toggle'}
          aria-pressed={active}
          onClick={onToggle}
        >
          惊喜
        </button>
      ) : (
        <span className="surprise-inline-label">随机中</span>
      )}
      {shuffleOn ? (
        <button
          type="button"
          className={spinning ? 'surprise-shuffle spinning' : 'surprise-shuffle'}
          onClick={handleReshuffle}
        >
          换一个顺序
        </button>
      ) : null}
    </div>
  )
}
