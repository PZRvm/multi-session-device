import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { format, type UPDATE_COPY } from '@shared/i18n'
import { resolveThemeMode, themeCssVariables } from '@shared/themeSystems'
import type { UpdateSnapshot } from '@shared/updates'
import { getThemeState } from '../theme/store'

export function isTrustedUpdatePage(url: string): boolean {
  const dev = process.env.ELECTRON_RENDERER_URL
  return ['index.html', 'settings.html'].some(
    (page) =>
      url ===
      (dev ? new URL(page, dev).href : pathToFileURL(join(__dirname, '../renderer', page)).href)
  )
}

const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )

/** 与参考窗口相同的文本子集，远端说明只能成为文字。 */
export function renderUpdateNotes(text: string): string {
  return text
    .split('\n')
    .map((raw) => {
      const line = raw.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
      const heading = /^#{1,6}\s+(.+)$/.exec(line)
      if (heading) return `<h2>${escape(heading[1])}</h2>`
      const item = /^[-*]\s+(.+)$/.exec(line)
      if (item) return `<p class="note-item">${escape(item[1])}</p>`
      return line.trim() ? `<p>${escape(line)}</p>` : ''
    })
    .join('')
}

const details = new WeakMap<BrowserWindow, BrowserWindow>()
const acceptUrl = 'https://update-action.invalid/accept'
const closeUrl = 'https://update-action.invalid/close'
const width = 480
const height = 420

export function showUpdateDetails(
  owner: BrowserWindow,
  state: UpdateSnapshot,
  copy: (typeof UPDATE_COPY)[keyof typeof UPDATE_COPY]
): Promise<{ version: string; action: 'download' | 'install' } | null> {
  const version = state.downloadedVersion ?? state.candidateVersion
  if (!version || owner.isDestroyed()) return Promise.resolve(null)
  const existing = details.get(owner)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return Promise.resolve(null)
  }
  const action = state.downloadedVersion ? 'install' : 'download'
  const title = escape(copy.detailsTitle)
  const { mode, systemId } = getThemeState()
  const scheme = resolveThemeMode(mode, nativeTheme.shouldUseDarkColors)
  const colors = themeCssVariables(systemId, scheme)
  const theme = Object.entries(colors)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  const notes = renderUpdateNotes(state.releaseNotes) || `<p>${escape(copy.noNotes)}</p>`
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>${title}</title><style>
      :root{color-scheme:${scheme};${theme}}
      *{box-sizing:border-box}
      body{margin:0;overflow:hidden;background:var(--board-bg-raised);color:var(--board-ink);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      main{height:100vh;display:flex;flex-direction:column;gap:16px;padding:16px 18px 9px}
      h1{margin:0;font-size:14px;font-weight:600;line-height:22px}
      .version{margin:8px 0 0;color:var(--board-ink-dim);font-size:12px}
      article{flex:1;min-height:0;overflow-y:auto;overflow-wrap:anywhere;font-size:13px;line-height:1.65}
      article p{margin:0 0 8px;white-space:pre-wrap}
      article h2{margin:16px 0 8px;font-size:13px;font-weight:600}
      article h2:first-child{margin-top:0}
      .note-item{padding-left:16px;position:relative}
      .note-item::before{content:"";position:absolute;left:3px;top:9px;width:4px;height:4px;border-radius:50%;background:currentColor}
      footer{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid var(--board-hairline);padding-top:6px}
      a{display:inline-flex;align-items:center;height:32px;padding:0 14px;border:1px solid var(--board-hairline);border-radius:6px;color:inherit;font-size:12px;text-decoration:none}
      a:hover{background:var(--board-hover-veil)}
      a.primary{border-color:transparent;background:var(--accent-strong);color:var(--accent-ink);font-weight:600}
      a.primary:hover{background:var(--accent-press)}
      :focus-visible{outline:2px solid var(--board-ink);outline-offset:-2px}
    </style></head><body><main aria-labelledby="title">
      <header><h1 id="title">${title}</h1><p class="version">${escape(format(copy.version, { v: version }))}</p></header>
      <article tabindex="0" aria-label="${escape(copy.releaseNotes)}">${notes}</article>
      <footer><a href="${closeUrl}">${escape(copy.later)}</a><a class="primary" href="${acceptUrl}">${escape(action === 'install' ? copy.restart : copy.downloadAction)}</a></footer>
    </main></body></html>`
  const mac = process.platform === 'darwin'
  const win = new BrowserWindow({
    parent: owner,
    modal: true,
    show: false,
    width,
    height: height + (mac ? 28 : 0),
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    ...(mac ? { frame: false } : {}),
    title: copy.detailsTitle,
    autoHideMenuBar: true,
    backgroundColor: colors['--board-bg-raised'],
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  details.set(owner, win)
  const page = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
  return new Promise((resolve) => {
    let accepted = false
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (url !== acceptUrl && url !== closeUrl) return
      accepted = url === acceptUrl
      win.close()
    })
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return
      event.preventDefault()
      win.close()
    })
    win.once('ready-to-show', () => {
      win.show()
      if (mac && win.getContentSize()[1] !== height) win.setContentSize(width, height)
    })
    win.once('closed', () => {
      details.delete(owner)
      resolve(accepted ? { version, action } : null)
    })
    void win.loadURL(page).catch(() => {
      if (!win.isDestroyed()) win.close()
    })
  })
}
