import { requestUrl } from 'obsidian'
import { createWereadLogin, responseWithHeaders, type FetchImpl } from '../../src/shared/weread-login'

export function createPluginWereadLogin() {
  const fetchImpl: FetchImpl = async (input, init = {}) => {
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value
    })
    const response = await requestUrl({
      url: input,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
      throw: false,
    })
    return responseWithHeaders(response.status, response.headers, response.text)
  }
  return createWereadLogin(fetchImpl)
}
