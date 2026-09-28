export type AppConfig = {
  authRequired: boolean
  sessionSecret: string
  wereadSecret: string | null
  cookieSecure: boolean
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const authRequired = env.LOCAL_AUTH === 'on'
  const sessionSecret = env.SESSION_SECRET ?? (authRequired ? '' : 'local-dev-session')
  if (authRequired && !sessionSecret) throw new Error('LOCAL_AUTH=on 时必须设置 SESSION_SECRET')
  if (authRequired && !env.WEREAD_SECRET) throw new Error('LOCAL_AUTH=on 时必须设置 WEREAD_SECRET')
  return {
    authRequired,
    sessionSecret,
    wereadSecret: env.WEREAD_SECRET ?? null,
    cookieSecure: env.COOKIE_SECURE === 'on',
  }
}
