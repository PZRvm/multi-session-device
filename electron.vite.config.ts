import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const sharedAlias = { '@shared': resolve('src/shared') }

/** 构建期剥掉 dev HMR 专用的 CSP ws: 放行——产物只保留 'self'（recording-processor 页） */
const stripDevOnlyCsp = (): Plugin => ({
  name: 'strip-dev-only-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace("connect-src 'self' ws:;", "connect-src 'self';")
})

export default defineConfig({
  main: { resolve: { alias: sharedAlias } },
  preload: { resolve: { alias: sharedAlias } },
  renderer: {
    // dev server 默认 6174（6173 留给兄弟项目 multi-session-browser 主仓库）；strictPort
    // 保证确定性——被占用时显式报错退出而非静默漂移。
    // git worktree 并行开发时用 MSD_DEV_PORT 环境变量覆盖端口，避免与主仓库/其他
    // worktree 撞车（分配规则见 .zcode/skills/create-worktree）
    server: { port: Number(process.env.MSD_DEV_PORT) || 6174, strictPort: true },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...sharedAlias
      }
    },
    plugins: [react(), stripDevOnlyCsp()],
    build: {
      rollupOptions: {
        // 六个独立入口：主窗、设备向导、设置窗、日志窗、对账详情窗、无线连接窗。
        input: {
          index: resolve('src/renderer/index.html'),
          wizard: resolve('src/renderer/wizard.html'),
          settings: resolve('src/renderer/settings.html'),
          logcat: resolve('src/renderer/logcat.html'),
          report: resolve('src/renderer/report.html'),
          wireless: resolve('src/renderer/wireless.html'),
          recordingProcessor: resolve('src/renderer/recording-processor.html')
        }
      }
    }
  }
})
