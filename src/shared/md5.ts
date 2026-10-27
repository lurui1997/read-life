const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

const K = Uint32Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 4294967296))

export function md5(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const padded = pad(bytes)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(16)
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4
      words[index] = padded[start]! | (padded[start + 1]! << 8) | (padded[start + 2]! << 16) | (padded[start + 3]! << 24)
    }
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let index = 0; index < 64; index += 1) {
      let mixed = 0
      let source = 0
      if (index < 16) {
        mixed = (b & c) | (~b & d)
        source = index
      } else if (index < 32) {
        mixed = (b & d) | (c & ~d)
        source = (5 * index + 1) % 16
      } else if (index < 48) {
        mixed = b ^ c ^ d
        source = (3 * index + 5) % 16
      } else {
        mixed = c ^ (b | ~d)
        source = (7 * index) % 16
      }
      const rotated = leftRotate(add(add(a, mixed >>> 0), add(K[index]!, words[source]!)), SHIFT[index]!)
      a = d
      d = c
      c = b
      b = add(rotated, b)
    }
    a0 = add(a0, a)
    b0 = add(b0, b)
    c0 = add(c0, c)
    d0 = add(d0, d)
  }

  return wordHex(a0) + wordHex(b0) + wordHex(c0) + wordHex(d0)
}

function pad(bytes: Uint8Array): Uint8Array {
  let length = bytes.length + 1
  while (length % 64 !== 56) length += 1
  const padded = new Uint8Array(length + 8)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const bits = bytes.length * 8
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bits >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bits / 4294967296) >>> 0, true)
  return padded
}

function add(left: number, right: number): number {
  return (left + right) >>> 0
}

function leftRotate(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function wordHex(word: number): string {
  const bytes = [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff]
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
