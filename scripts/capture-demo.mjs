import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const framesDir = path.join(root, 'docs', 'frames')
const base = process.env.DEMO_BASE ?? 'http://127.0.0.1:8788'

fs.mkdirSync(framesDir, { recursive: true })

async function capture(page, name) {
  await page.screenshot({
    path: path.join(framesDir, `${name}.png`),
    animations: 'disabled',
  })
  console.log('captured', name)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

await page.goto(base, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.setItem('read-life.feature-showcase-dismissed', '1')
  localStorage.setItem('read-life.shelf-random-order', '1')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)
await capture(page, '01-shelf')

await page.getByRole('link', { name: '设置' }).click()
await page.waitForTimeout(700)
await capture(page, '02-settings')

await page.getByRole('link', { name: '返回书架' }).click()
await page.waitForTimeout(600)
await page.getByRole('tab', { name: '随机' }).click()
await page.waitForTimeout(1200)
await capture(page, '03-surprise')

await page.getByRole('button', { name: '换一个顺序' }).click()
await page.waitForTimeout(900)
await capture(page, '04-surprise-shuffle')

const bookId = await page.evaluate(async () => {
  const res = await fetch('/api/books')
  const data = await res.json()
  const book =
    data.books.find((item) => item.highlightCount > 5) ??
    data.books.find((item) => item.highlightCount > 0) ??
    data.books[0]
  return book?.bookId ?? ''
})

if (bookId) {
  await page.goto(`${base}/book/${encodeURIComponent(bookId)}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await capture(page, '05-book')
  await page.evaluate(() => window.scrollTo(0, 420))
  await page.waitForTimeout(600)
  await capture(page, '06-book-scroll')
}

await browser.close()
console.log('book', bookId)
