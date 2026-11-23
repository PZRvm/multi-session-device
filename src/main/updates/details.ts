import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { format, type UPDATE_COPY } from '@shared/i18n'
import type { UpdateSnapshot } from '@shared/updates'

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

const details = new WeakMap<BrowserWindow, BrowserWindow>()
const acceptUrl = 'https://update-action.invalid/accept'
const closeUrl = 'https://update-action.invalid/close'

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
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title><style>
    :root{color-scheme:light dark}body{margin:0;padding:24px;font:14px system-ui,sans-serif;color:CanvasText;background:Canvas}
    h1{font-size:19px;margin:0 0 12px}p{margin:0 0 12px}
    pre{font:inherit;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;margin:0 0 16px;background:Field;padding:12px;border:1px solid GrayText;border-radius:6px}
    footer{display:flex;justify-content:flex-end;gap:8px}a{padding:6px 12px;border:1px solid GrayText;border-radius:6px;color:CanvasText;text-decoration:none}
    a.primary{background:Highlight;color:HighlightText;border-color:Highlight}a:focus-visible{outline:2px solid Highlight;outline-offset:2px}
    </style></head><body><h1>${escape(format(copy.version, { v: version }))}</h1>
    <p>${escape(copy.releaseNotes)}</p><pre tabindex="0">${escape(state.releaseNotes || copy.noNotes)}</pre>
    <footer><a href="${closeUrl}">${escape(copy.later)}</a><a class="primary" href="${acceptUrl}">${escape(action === 'install' ? copy.restart : copy.downloadAction)}</a></footer></body></html>`
  const win = new BrowserWindow({
    parent: owner,
    modal: true,
    show: false,
    width: 500,
    height: 430,
    title: copy.detailsTitle,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#222222' : '#ffffff',
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
    win.once('ready-to-show', () => win.show())
    win.once('closed', () => {
      details.delete(owner)
      resolve(accepted ? { version, action } : null)
    })
    void win.loadURL(page).catch(() => {
      if (!win.isDestroyed()) win.close()
    })
  })
}
