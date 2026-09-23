import type { AppDatabase } from './db'
import { parseBookInfo } from './book-info'
import type { WereadClient } from './weread'

const METADATA_CONCURRENCY = 8

export async function backfillBookMetadata(
  db: AppDatabase,
  client: WereadClient,
): Promise<void> {
  const pending = db.listBooksMissingMetadata()
  if (pending.length === 0) return
  let index = 0
  const workers = Array.from({ length: Math.min(METADATA_CONCURRENCY, pending.length) }, async () => {
    while (index < pending.length) {
      const bookId = pending[index]
      index += 1
      try {
        const data = await client.call('/book/info', { bookId })
        const info = parseBookInfo(data)
        db.setBookMetadata(bookId, info)
      } catch {
        // 单本元数据失败不影响其他书
      }
    }
  })
  await Promise.all(workers)
}
