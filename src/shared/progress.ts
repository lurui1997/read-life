export function normalizeProgress(progress: number | null, finishReading: boolean): number | null {
  if (finishReading) return 100
  return progress
}
