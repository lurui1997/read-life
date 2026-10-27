import { describe, expect, it } from 'vitest'
import { createWereadLogin, responseWithHeaders, type FetchImpl } from '../src/shared/weread-login'

function scripted(handler: (url: string, cookie: string) => { status?: number; headers?: Record<string, string>; body: unknown }): FetchImpl {
  return async (url, init) => {
    const cookie = new Headers(init?.headers).get('cookie') ?? ''
    const result = handler(url, cookie)
    return responseWithHeaders(result.status ?? 200, result.headers ?? {}, JSON.stringify(result.body))
  }
}

describe('weread login', () => {
  it('scans, keeps cookies, and returns the api key', async () => {
    const seen: string[] = []
    const login = createWereadLogin(scripted((url, cookie) => {
      seen.push(`${url} cookie=${cookie}`)
      if (url.endsWith('/api/auth/getLoginUid')) return { headers: { 'set-cookie': 'wr_ssid=abc; Path=/' }, body: { uid: 'uid-1' } }
      if (url.includes('/api/auth/getLoginInfo')) return { body: { succeed: true, webLoginVid: 42, accessToken: 'skey' } }
      if (url.includes('/api/userInfo')) return { body: { data: { name: '路人' } } }
      if (url.endsWith('/api/skills/apikeyGet')) return { body: { apikey: 'wrk-fresh' } }
      return { body: {} }
    }))
    const started = await login.start('local')
    expect(started.qrDataUrl.startsWith('data:image/png')).toBe(true)
    const result = await login.poll(started.loginId, 'local')
    expect(result.status).toBe('done')
    expect(result.apiKey).toBe('wrk-fresh')
    expect(result.wrName).toBe('路人')
    const keyRequest = seen.find((line) => line.includes('/api/skills/apikeyGet')) ?? ''
    expect(keyRequest).toContain('wr_ssid=abc')
    expect(keyRequest).toContain('wr_vid=42')
    expect(keyRequest).toContain('wr_skey=skey')
  })

  it('asks for the manual key when the scan needs a code', async () => {
    const login = createWereadLogin(scripted((url) => {
      if (url.endsWith('/api/auth/getLoginUid')) return { body: { uid: 'uid-1' } }
      return { body: { logicCode: 'NEED_OTP' } }
    }))
    const started = await login.start('local')
    const result = await login.poll(started.loginId, 'local')
    expect(result).toEqual({ status: 'error', error: '这次登录需要验证码，请用高级选项手动填写 API Key' })
  })

  it('splits stacked set-cookie headers', () => {
    const response = responseWithHeaders(200, { 'set-cookie': 'a=1; Path=/\nb=2; Path=/' }, '')
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })
})
