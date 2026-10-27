import { requestUrl } from 'obsidian'
import { GATEWAY_URL, SKILL_VERSION } from '../../src/server/weread'
import type { Gateway } from '../../src/shared/vault-sync'

export function createGateway(apiKey: string): Gateway {
  const key = apiKey.trim()
  return {
    async call(apiName, params = {}) {
      if (!key) throw new Error('先填写微信读书 API Key')
      let response: Awaited<ReturnType<typeof requestUrl>>
      try {
        response = await requestUrl({
          url: GATEWAY_URL,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_name: apiName,
            skill_version: SKILL_VERSION,
            ...params,
          }),
          throw: false,
        })
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : '微信读书请求失败')
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`微信读书请求失败（HTTP ${response.status}）`)
      }
      const data = response.json as { errcode?: number; errmsg?: string }
      if (typeof data?.errcode === 'number' && data.errcode !== 0) {
        throw new Error(data.errmsg || `微信读书返回错误 ${data.errcode}`)
      }
      return data
    },
  }
}
