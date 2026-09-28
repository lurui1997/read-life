import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'

const BASE = 'https://weread.qq.com'

export type WereadLoginStatus = 'pending' | 'done' | 'error'

export type WereadLoginResult = {
  status: WereadLoginStatus
  apiKey?: string
  wrVid?: string | null
  wrName?: string | null
  cookies?: string
  error?: string
}

type PendingLogin = {
  userId: string
  uid: string
  cookies: Map<string, string>
  createdAt: number
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

export function createWereadLogin(fetchImpl: FetchImpl = fetch) {
  const pending = new Map<string, PendingLogin>()

  return {
    async start(userId: string): Promise<{ loginId: string; qrDataUrl: string }> {
      const jar = new Map<string, string>()
      const uidPayload = await requestJson(fetchImpl, jar, `${BASE}/api/auth/getLoginUid`)
      const uid = typeof uidPayload.uid === 'string' ? uidPayload.uid : ''
      if (!uid) throw new Error('微信读书没有返回登录码')
      const loginId = randomUUID()
      pending.set(loginId, { userId, uid, cookies: jar, createdAt: Date.now() })
      const qrDataUrl = await QRCode.toDataURL(`${BASE}/web/confirm?uid=${encodeURIComponent(uid)}`, { margin: 1, width: 240 })
      return { loginId, qrDataUrl }
    },

    async poll(loginId: string, userId: string): Promise<WereadLoginResult> {
      const session = pending.get(loginId)
      if (!session || session.userId !== userId) return { status: 'error', error: '登录已失效，请重新获取二维码' }
      if (Date.now() - session.createdAt > 5 * 60 * 1000) {
        pending.delete(loginId)
        return { status: 'error', error: '二维码已过期' }
      }
      const info = await requestJson(
        fetchImpl,
        session.cookies,
        `${BASE}/api/auth/getLoginInfo?uid=${encodeURIComponent(session.uid)}`,
        { signal: AbortSignal.timeout(25_000) },
      ).catch(() => null)
      if (!info) return { status: 'pending' }
      if (info.logicCode === 'LOGIN_TIMEOUT') {
        pending.delete(loginId)
        return { status: 'error', error: '二维码已失效，请重新获取' }
      }
      if (info.logicCode === 'NEED_OTP' || info.logicCode === 'OTP_EXPIRED' || info.logicCode === 'OTP_NOT_MATCH') {
        pending.delete(loginId)
        return { status: 'error', error: '这次登录需要验证码，请用高级选项手动填写 API Key' }
      }
      const vid = typeof info.webLoginVid === 'string' || typeof info.webLoginVid === 'number' ? String(info.webLoginVid) : ''
      const skey = typeof info.accessToken === 'string' ? info.accessToken : ''
      if (!info.succeed || !vid || !skey) return { status: 'pending' }
      session.cookies.set('wr_vid', vid)
      session.cookies.set('wr_skey', skey)
      const profile = await requestJson(fetchImpl, session.cookies, `${BASE}/api/userInfo?userVid=${encodeURIComponent(vid)}`).catch(() => ({} as Record<string, unknown>))
      const keyPayload = await requestJson(fetchImpl, session.cookies, `${BASE}/api/skills/apikeyGet`).catch(() => ({} as Record<string, unknown>))
      const apiKey = typeof keyPayload.apikey === 'string' ? keyPayload.apikey : ''
      if (!apiKey) {
        pending.delete(loginId)
        return { status: 'error', error: '扫码成功但没有拿到 API Key，请用高级选项手动填写' }
      }
      pending.delete(loginId)
      const name = profileName(profile)
      const cookies = [...session.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
      return {
        status: 'done',
        apiKey,
        wrVid: vid,
        wrName: name,
        cookies,
      }
    },

    cancel(loginId: string) {
      pending.delete(loginId)
    },
  }
}

async function requestJson(fetchImpl: FetchImpl, jar: Map<string, string>, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers)
  headers.set('User-Agent', 'Mozilla/5.0')
  headers.set('Accept', 'application/json, text/plain, */*')
  headers.set('Referer', `${BASE}/`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  if (cookie) headers.set('Cookie', cookie)
  const response = await fetchImpl(url, { ...init, headers })
  absorbCookies(jar, response.headers)
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

function profileName(profile: Record<string, unknown>): string | null {
  const data = profile.data
  if (data && typeof data === 'object' && 'name' in data && typeof data.name === 'string') return data.name
  if (typeof profile.name === 'string') return profile.name
  return null
}

function absorbCookies(jar: Map<string, string>, headers: Headers) {
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  const single = headers.get('set-cookie')
  const lines = raw.length > 0 ? raw : single ? [single] : []
  for (const line of lines) {
    const pair = line.split(';')[0] ?? ''
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}
