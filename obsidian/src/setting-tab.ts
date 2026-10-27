import { Notice, PluginSettingTab, type App, type Plugin } from 'obsidian'
import type { WereadLoginResult } from '../../src/shared/weread-login'
import { createGateway } from './gateway'
import type { ReadLifeHost } from './host'
import { cleanNoteFolder } from '../../src/shared/vault-note'
import { createPluginWereadLogin } from './weread-fetch'

const LOCAL_USER = 'local'

export class ReadLifeSettingTab extends PluginSettingTab {
  private readonly host: ReadLifeHost
  private readonly login = createPluginWereadLogin()
  private generation = 0
  private activeLoginId: string | null = null
  private hintEl: HTMLElement | null = null
  private errorEl: HTMLElement | null = null
  private qrEl: HTMLElement | null = null

  constructor(app: App, plugin: Plugin & ReadLifeHost) {
    super(app, plugin)
    this.host = plugin
  }

  hide(): void {
    this.stopLogin()
    super.hide()
  }

  display(): void {
    this.stopLogin()
    const { containerEl } = this
    containerEl.empty()
    containerEl.addClass('read-life-settings')
    this.renderBind(containerEl)
    this.renderShelf(containerEl)
    this.renderManual(containerEl)
    this.renderFolder(containerEl)
  }

  private renderBind(containerEl: HTMLElement) {
    const configured = this.host.settings.apiKey.trim().length > 0
    const head = containerEl.createDiv({ cls: 'read-life-settings-head' })
    head.createEl('h2', { text: '微信读书' })
    head.createEl('span', {
      cls: configured ? 'read-life-settings-pill' : 'read-life-settings-pill is-wait',
      text: configured ? '已绑定' : '未绑定',
    })
    containerEl.createEl('p', {
      text: configured ? this.host.settings.wrName || '已连接' : '用微信扫码，把你的书架接到这个库上。',
      cls: 'setting-item-description',
    })
    this.qrEl = containerEl.createDiv({ cls: 'read-life-settings-qr' })
    const actions = containerEl.createDiv({ cls: 'read-life-settings-actions' })
    const scan = actions.createEl('button', { text: configured ? '更换账号' : '扫码绑定', cls: 'mod-cta' })
    scan.type = 'button'
    scan.addEventListener('click', () => {
      void this.beginScan()
    })
    if (configured) {
      const unlink = actions.createEl('button', { text: '解除绑定' })
      unlink.type = 'button'
      unlink.addEventListener('click', () => {
        void this.unlink()
      })
    }
    this.hintEl = containerEl.createEl('p', { cls: 'setting-item-description' })
    this.errorEl = containerEl.createEl('p', { cls: 'error' })
  }

  private renderShelf(containerEl: HTMLElement) {
    containerEl.createEl('h2', { text: '我的书架' })
    const stat = containerEl.createEl('p', { cls: 'read-life-settings-stat', text: '…' })
    const label = containerEl.createEl('p', { cls: 'setting-item-description', text: '本书在架上' })
    void this.host.getCatalog().then(
      (catalog) => {
        stat.setText(catalog.books.length.toLocaleString('zh-CN'))
        if (catalog.books.length === 0) label.setText('同步完成后，数字会变成你的在架本数。')
      },
      () => {
        stat.setText('—')
        label.setText('索引读不出来。')
      },
    )
    containerEl.createEl('h3', { text: '同步' })
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: this.host.settings.lastSyncMessage ? `上次同步：${this.host.settings.lastSyncMessage}` : '还没有同步记录。',
    })
    const actions = containerEl.createDiv({ cls: 'read-life-settings-actions' })
    const sync = actions.createEl('button', { text: '立即更新', cls: 'mod-cta' })
    sync.type = 'button'
    sync.addEventListener('click', () => {
      void this.host.sync(false)
    })
    const force = actions.createEl('button', { text: '强制同步' })
    force.type = 'button'
    force.addEventListener('click', () => {
      void this.host.sync(true)
    })
  }

  private renderManual(containerEl: HTMLElement) {
    const configured = this.host.settings.apiKey.trim().length > 0
    const details = containerEl.createEl('details', { cls: 'read-life-settings-manual' })
    details.createEl('summary', { text: '高级：手动填写 API Key' })
    details.createEl('p', {
      cls: 'setting-item-description',
      text: configured ? '已绑定。保存新的 Key 之前会先向微信读书确认。' : '扫码失败时可以粘贴 wrk- 开头的 Key。',
    })
    const input = details.createEl('input', { attr: { type: 'password', placeholder: '粘贴 API Key' } })
    input.autocomplete = 'off'
    const save = details.createEl('button', { text: '保存', cls: 'mod-cta' })
    save.type = 'button'
    save.addEventListener('click', () => {
      void this.saveManualKey(input)
    })
  }

  private renderFolder(containerEl: HTMLElement) {
    containerEl.createEl('h2', { text: '笔记目录' })
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '每本有划线的书一篇笔记。划线或进度变了会覆盖生成的正文，强制同步也会。写在 %% read-life:user %% 后面的内容会留下。',
    })
    const input = containerEl.createEl('input', { attr: { type: 'text', placeholder: '折角', value: this.host.settings.noteFolder } })
    input.addEventListener('change', () => {
      this.host.settings.noteFolder = cleanNoteFolder(input.value)
      input.value = this.host.settings.noteFolder
      void this.host.saveSettings()
    })
  }

  private stopLogin() {
    this.generation += 1
    if (this.activeLoginId) this.login.cancel(this.activeLoginId)
    this.activeLoginId = null
  }

  private async beginScan() {
    const generation = this.generation + 1
    this.stopLogin()
    this.generation = generation
    this.setHint('正在生成二维码…')
    this.setError('')
    try {
      const started = await this.login.start(LOCAL_USER)
      if (generation !== this.generation) {
        this.login.cancel(started.loginId)
        return
      }
      this.activeLoginId = started.loginId
      this.qrEl?.empty()
      this.qrEl?.createEl('img', { attr: { src: started.qrDataUrl, width: '196', height: '196', alt: '微信读书登录二维码' } })
      this.qrEl?.createEl('p', { text: '打开微信，扫一扫' })
      this.setHint('请用微信扫描二维码')
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await sleep(2000)
        if (generation !== this.generation) return
        const result = await this.login.poll(started.loginId, LOCAL_USER)
        if (generation !== this.generation) return
        if (result.status === 'done') {
          await this.acceptKey(result)
          return
        }
        if (result.status === 'error') {
          this.clearQr()
          this.setError(result.error ?? '扫码失败')
          return
        }
      }
      this.login.cancel(started.loginId)
      this.clearQr()
      this.setError('等待超时，请重试')
    } catch (error) {
      if (generation !== this.generation) return
      this.clearQr()
      this.setError(error instanceof Error ? error.message : '无法生成二维码')
    }
  }

  private async acceptKey(result: WereadLoginResult) {
    const apiKey = result.apiKey?.trim() ?? ''
    if (!apiKey) {
      this.setError('扫码成功但没有拿到 API Key，请用高级选项手动填写')
      return
    }
    try {
      await createGateway(apiKey).call('/user/notebooks', { count: 1 })
    } catch {
      this.clearQr()
      this.setError('API Key 无效')
      return
    }
    this.host.settings.apiKey = apiKey
    this.host.settings.wrName = result.wrName ?? null
    await this.host.saveSettings()
    new Notice(result.wrName ? `已绑定 ${result.wrName}` : '已绑定微信读书')
    this.display()
  }

  private async saveManualKey(input: HTMLInputElement) {
    const apiKey = input.value.trim()
    this.setError('')
    if (!apiKey) {
      this.setError('API Key 无效')
      return
    }
    try {
      await createGateway(apiKey).call('/user/notebooks', { count: 1 })
    } catch {
      this.setError('API Key 无效')
      return
    }
    this.host.settings.apiKey = apiKey
    await this.host.saveSettings()
    input.value = ''
    new Notice('API Key 已保存。')
    this.display()
  }

  private async unlink() {
    this.stopLogin()
    this.host.settings.apiKey = ''
    this.host.settings.wrName = null
    await this.host.saveSettings()
    new Notice('已解除绑定')
    this.display()
  }

  private setHint(text: string) {
    if (this.hintEl) this.hintEl.setText(text)
  }

  private setError(text: string) {
    if (this.errorEl) this.errorEl.setText(text)
  }

  private clearQr() {
    this.qrEl?.empty()
    this.activeLoginId = null
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
