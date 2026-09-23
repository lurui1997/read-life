import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { wereadReaderUrl } from '../src/server/weread-url'

function pluginUrl(bookId: string): string {
  const str = createHash('md5').update(bookId).digest('hex')
  const fa: [string, string[]] = /^\d*$/.test(bookId)
    ? ['3', bookId.match(/.{1,9}/g)?.map((chunk) => parseInt(chunk, 10).toString(16)) ?? []]
    : ['4', [[...bookId].map((char) => char.charCodeAt(0).toString(16)).join('')]]
  let token = str.slice(0, 3) + fa[0] + '2' + str.slice(-2)
  fa[1].forEach((part, index) => {
    const length = part.length.toString(16)
    token += (length.length === 1 ? `0${length}` : length) + part
    if (index < fa[1].length - 1) token += 'g'
  })
  if (token.length < 20) token += str.slice(0, 20 - token.length)
  token += createHash('md5').update(token).digest('hex').slice(0, 3)
  return `https://weread.qq.com/web/reader/${token}`
}

describe('微信读书链接', () => {
  it('数字和非数字 bookId 都落到阅读器地址', () => {
    expect(wereadReaderUrl('3300027114')).toBe(pluginUrl('3300027114'))
    expect(wereadReaderUrl('CB_GO24A4A5D4E46fE6sw5xD8YI')).toBe(pluginUrl('CB_GO24A4A5D4E46fE6sw5xD8YI'))
    expect(wereadReaderUrl('3300027114').startsWith('https://weread.qq.com/web/reader/')).toBe(true)
  })
})
