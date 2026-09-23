export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '未同步'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`
  if (hours > 0) return `${hours} 小时`
  return `${minutes} 分钟`
}

export function formatProgress(progress: number | null): string {
  if (progress == null) return '未同步'
  return `${progress}%`
}
