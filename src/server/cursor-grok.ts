import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { HandbookModel } from './handbook-run'

const execFileAsync = promisify(execFile)
const modelId = process.env.HANDBOOK_MODEL ?? 'grok-4.7-high'
const missingCli = '生成需要本机已登录的 Cursor CLI（agent）'

export function cursorAgentReady(): boolean {
  if (process.env.CURSOR_AGENT_BIN === 'off') return false
  const bin = process.env.CURSOR_AGENT_BIN || 'agent'
  if (path.isAbsolute(bin)) return fs.existsSync(bin)
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, bin)))
}

export function createCursorHandbookModel(): HandbookModel {
  return {
    complete(prompt) {
      return ask(prompt, makeWorkdir(), false)
    },
    async draw(prompt, file) {
      const dir = path.dirname(file)
      const name = path.basename(file)
      fs.mkdirSync(dir, { recursive: true })
      await ask([
        '根据下面的说明画一幅 PNG 插画。',
        `把图片写到当前目录的 ${name}，并覆盖已有文件。`,
        '不要修改其他文件。',
        prompt,
      ].join('\n'), dir, true)
      if (!fs.existsSync(file)) throw new Error('这一章没有画出图')
    },
  }
}

function makeWorkdir(): string {
  const root = process.env.HANDBOOK_AGENT_WORKDIR ?? os.tmpdir()
  fs.mkdirSync(root, { recursive: true })
  return fs.mkdtempSync(path.join(root, 'read-life-handbook-'))
}

async function ask(prompt: string, cwd: string, write: boolean): Promise<string> {
  if (!cursorAgentReady()) throw new Error(missingCli)
  const bin = process.env.CURSOR_AGENT_BIN || 'agent'
  const args = ['-p', '--output-format', 'text', '--model', modelId, '--trust']
  const message = write
    ? prompt
    : `不要使用工具，不要运行命令，不要写代码，不要检查字数。直接回复。\n${prompt}`
  if (write) args.push('--force', '--sandbox', 'disabled')
  else args.push('--mode', 'ask')
  args.push(message)
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd,
      timeout: 10 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    })
    const text = stdout.trim()
    if (!text) throw new Error('模型没有返回文字')
    return text
  } catch (error) {
    if (error instanceof Error && (error.message === '模型没有返回文字' || error.message === missingCli)) throw error
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') throw new Error(missingCli)
    const stderr = typeof error === 'object' && error && 'stderr' in error ? String(error.stderr ?? '') : ''
    const line = stderr.split('\n').map((item) => item.trim()).find((item) => item.length > 0) ?? ''
    throw new Error(line ? `Cursor CLI 没有完成：${line.slice(0, 180)}` : 'Cursor CLI 没有完成')
  }
}
