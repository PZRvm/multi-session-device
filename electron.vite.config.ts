import { readFileSync } from 'node:fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const sharedAlias = { '@shared': resolve('src/shared') }

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
}

function devPort(): number {
  const override = Number(process.env.MSD_DEV_PORT)
  if (isPort(override)) return override
  try {
    const metadata: unknown = JSON.parse(readFileSync(resolve('.worktree.json'), 'utf8'))
    if (metadata && typeof metadata === 'object' && 'port' in metadata && isPort(metadata.port)) {
      return metadata.port
    }
  } catch {
    // 本地可选元数据缺失、不可读或损坏时沿用主仓库默认端口。
  }
  return 6174
}

/** 构建期剥掉 dev HMR 专用的 CSP ws: 放行——产物只保留 'self'（recording-processor 页） */
const stripDevOnlyCsp = (): Plugin => ({
  name: 'strip-dev-only-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace("connect-src 'self' ws:;", "connect-src 'self';")
})

export default defineConfig(({ command }) => ({
  main: { resolve: { alias: sharedAlias } },
  preload: { resolve: { alias: sharedAlias } },
  renderer: {
    // dev server 默认 6174（6173 留给兄弟项目 multi-session-browser 主仓库）；strictPort
    // 保证确定性——被占用时显式报错退出而非静默漂移。
    // worktree 自动读取本地登记端口；MSD_DEV_PORT 可显式覆盖。
    // 分配规则见 .zcode/skills/create-worktree，主仓库无元数据时仍用 6174。
    server: { port: command === 'serve' ? devPort() : 6174, strictPort: true },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...sharedAlias
      }
    },
    plugins: [react(), stripDevOnlyCsp()],
    build: {
      rollupOptions: {
        // 七个独立入口：主窗、设备向导、设置窗、日志窗、对账详情窗、无线连接窗、
        // 截图编辑窗。
        input: {
          index: resolve('src/renderer/index.html'),
          wizard: resolve('src/renderer/wizard.html'),
          settings: resolve('src/renderer/settings.html'),
          logcat: resolve('src/renderer/logcat.html'),
          report: resolve('src/renderer/report.html'),
          wireless: resolve('src/renderer/wireless.html'),
          recordingProcessor: resolve('src/renderer/recording-processor.html'),
          screenshotEditor: resolve('src/renderer/screenshot-editor.html')
        }
      }
    }
  }
}))
