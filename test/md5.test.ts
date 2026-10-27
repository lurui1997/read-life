import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { md5 } from '../src/shared/md5'

describe('md5', () => {
  it('和 Node crypto 一致', () => {
    for (const sample of ['', 'abc', '三体', '3300027114']) {
      expect(md5(sample)).toBe(createHash('md5').update(sample).digest('hex'))
    }
  })
})
