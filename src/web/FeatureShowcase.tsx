import { useEffect, useState } from 'react'

const showcaseDismissKey = 'read-life.feature-showcase-dismissed'

type Slide = {
  id: string
  label: string
  title: string
  description: string
  preview: 'shelf' | 'browse' | 'book' | 'surprise'
}

const slides: Slide[] = [
  {
    id: 'shelf',
    label: '书架',
    title: '五种方式，浏览整架书',
    description: '按分组、进度、推荐值、分类或随机切换视角。分组默认折叠，点开再读。',
    preview: 'shelf',
  },
  {
    id: 'browse',
    label: '分组',
    title: '左右分栏，专注一个主题',
    description: '分组与分类视图左侧导航、右侧书 grid，下拉自动加载更多。',
    preview: 'browse',
  },
  {
    id: 'book',
    label: '书页',
    title: '划线按章节静静呈现',
    description: '点进一本书，按章节回看全部划线。窄栏排版，适合沉浸阅读。',
    preview: 'book',
  },
  {
    id: 'surprise',
    label: '惊喜',
    title: '惊喜模式，邂逅深处的书',
    description: '打开惊喜模式，每个分组随机排列。点「换一个顺序」，重新洗牌。',
    preview: 'surprise',
  },
]

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
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length)
    }, 5200)
    return () => window.clearInterval(timer)
  }, [paused])

  const slide = slides[index]!

  function dismiss() {
    try {
      localStorage.setItem(showcaseDismissKey, '1')
    } catch {
      // ignore
    }
    onDismiss()
  }

  return (
    <section
      className="feature-showcase"
      aria-label="功能介绍"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="feature-showcase-head">
        <p className="feature-showcase-eyebrow">功能导览</p>
        <button type="button" className="feature-showcase-close" onClick={dismiss} aria-label="关闭功能导览">
          关闭
        </button>
      </div>

      <div className="feature-showcase-body">
        <div className="feature-showcase-copy">
          <p className="feature-showcase-label">{slide.label}</p>
          <h2 className="feature-showcase-title">{slide.title}</h2>
          <p className="feature-showcase-desc">{slide.description}</p>
          {slide.id === 'surprise' && onTrySurprise ? (
            <button type="button" className="feature-showcase-action" onClick={onTrySurprise}>
              试试惊喜模式
            </button>
          ) : null}
        </div>

        <div className="feature-showcase-stage" aria-hidden="true">
          {slides.map((item, itemIndex) => (
            <div
              key={item.id}
              className={itemIndex === index ? 'feature-preview active' : 'feature-preview'}
            >
              <PreviewMock kind={item.preview} animate={itemIndex === index} />
            </div>
          ))}
        </div>
      </div>

      <div className="feature-showcase-foot">
        <div className="feature-showcase-dots" role="tablist" aria-label="导览分页">
          {slides.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={itemIndex === index}
              aria-label={`${item.label}：${item.title}`}
              className={itemIndex === index ? 'feature-dot active' : 'feature-dot'}
              onClick={() => setIndex(itemIndex)}
            />
          ))}
        </div>
        <p className="feature-showcase-progress muted">{index + 1} / {slides.length}</p>
      </div>
    </section>
  )
}

function PreviewMock({ kind, animate }: { kind: Slide['preview']; animate: boolean }) {
  if (kind === 'shelf') {
    return (
      <div className={`mock mock-shelf ${animate ? 'mock-animate' : ''}`}>
        <div className="mock-tabs">
          <span className="active" />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="mock-sections">
          <div className="mock-section" />
          <div className="mock-section dim" />
          <div className="mock-section dim" />
        </div>
      </div>
    )
  }

  if (kind === 'browse') {
    return (
      <div className={`mock mock-browse ${animate ? 'mock-animate' : ''}`}>
        <div className="mock-sidebar">
          <div className="mock-nav-item active" />
          <div className="mock-nav-item" />
          <div className="mock-nav-item" />
        </div>
        <div className="mock-grid">
          <div className="mock-card" />
          <div className="mock-card" />
          <div className="mock-card" />
          <div className="mock-card" />
        </div>
      </div>
    )
  }

  if (kind === 'book') {
    return (
      <div className={`mock mock-book ${animate ? 'mock-animate' : ''}`}>
        <div className="mock-cover" />
        <div className="mock-reading">
          <div className="mock-chapter" />
          <div className="mock-highlight" />
          <div className="mock-highlight short" />
        </div>
      </div>
    )
  }

  return (
    <div className={`mock mock-surprise ${animate ? 'mock-animate' : ''}`}>
      <div className="mock-surprise-bar">
        <span className="mock-spark" />
        <span className="mock-bar-copy" />
        <span className="mock-switch on" />
      </div>
      <div className="mock-shuffle-grid">
        <div className="mock-card a" />
        <div className="mock-card b" />
        <div className="mock-card c" />
      </div>
    </div>
  )
}
