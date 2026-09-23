import { createHash } from 'node:crypto'

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function encodeBookId(id: string): [string, string[]] {
  if (/^\d*$/.test(id)) {
    const parts: string[] = []
    for (let index = 0; index < id.length; index += 9) {
      const chunk = id.slice(index, Math.min(index + 9, id.length))
      parts.push(parseInt(chunk, 10).toString(16))
    }
    return ['3', parts]
  }
  let encoded = ''
  for (let index = 0; index < id.length; index += 1) {
    encoded += id.charCodeAt(index).toString(16)
  }
  return ['4', [encoded]]
}

export function wereadReaderUrl(bookId: string): string {
  const digest = md5(bookId)
  const [flag, parts] = encodeBookId(bookId)
  let token = digest.slice(0, 3) + flag + '2' + digest.slice(-2)
  for (let index = 0; index < parts.length; index += 1) {
    const length = parts[index].length.toString(16)
    token += (length.length === 1 ? `0${length}` : length) + parts[index]
    if (index < parts.length - 1) token += 'g'
  }
  if (token.length < 20) token += digest.slice(0, 20 - token.length)
  token += md5(token).slice(0, 3)
  return `https://weread.qq.com/web/reader/${token}`
}
