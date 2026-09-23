export const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway'
export const SKILL_VERSION = '1.0.3'

export type WereadClient = {
  call(apiName: string, params?: Record<string, unknown>): Promise<unknown>
}

export class WereadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WereadError'
  }
}

type FetchImpl = (input: string, init: RequestInit) => Promise<Response>

export function createWereadClient(apiKey: string, fetchImpl: FetchImpl = fetch): WereadClient {
  return {
    async call(apiName, params = {}) {
      let response: Response
      try {
        response = await fetchImpl(GATEWAY_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_name: apiName,
            skill_version: SKILL_VERSION,
            ...params,
          }),
          signal: AbortSignal.timeout(10_000),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '微信读书请求失败'
        throw new WereadError(message.includes('abort') || message.includes('timed out') ? '微信读书请求超时' : message)
      }
      if (!response.ok) {
        throw new WereadError(`微信读书请求失败（HTTP ${response.status}）`)
      }
      const data = (await response.json()) as { errcode?: number; errmsg?: string }
      if (typeof data?.errcode === 'number' && data.errcode !== 0) {
        throw new WereadError(data.errmsg || `微信读书返回错误 ${data.errcode}`)
      }
      return data
    },
  }
}
