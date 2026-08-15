import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scanAll } from './aggregate'
import { writeDefaultPricingFile } from './pricing'
import type { RangeKey, ScanResult } from '@shared/types'

const isDev = !app.isPackaged

/** electron-vite emits `.mjs` for ESM preloads and `.js` for CJS ones. */
function preloadPath(): string {
  const mjs = join(__dirname, '../preload/index.mjs')
  return existsSync(mjs) ? mjs : join(__dirname, '../preload/index.js')
}

async function writeDefaultPricingFileIfMissing(): Promise<string> {
  const { PRICING_FILE } = await import('./pricing')
  if (!existsSync(PRICING_FILE)) return writeDefaultPricingFile()
  return PRICING_FILE
}


async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#0b0d10',
    show: false,
    autoHideMenuBar: true,
    title: 'Token Atlas',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    await win.loadURL(devUrl)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Headless QA hook: `TK_SNAPSHOT=<png path>` renders the window once and exits.
  // `TK_THEME=light` flips the persisted theme before the shot.
  const snapshot = process.env['TK_SNAPSHOT']
  if (snapshot) {
    win.webContents.on('console-message', (_e, _lvl, message) => console.log('[renderer]', message))
    const theme = process.env['TK_THEME']
    if (theme) {
      await win.webContents.executeJavaScript(
        `localStorage.setItem('tk.theme', ${JSON.stringify(theme)}); location.reload()`
      )
    }
    setTimeout(async () => {
      // Scroll first, so `TK_CLICK` coordinates can target anything on the page
      // rather than only what happens to be above the fold.
      const scrollY = Number(process.env['TK_SCROLL'] ?? '0')
      if (scrollY > 0) {
        await win.webContents.executeJavaScript(
          `document.querySelector('.main').scrollTo(0, ${scrollY})`
        )
        await new Promise((r) => setTimeout(r, 500))
      }
      // `TK_CLICK=x,y` clicks once before the shot; `x,y;x,y` clicks in sequence
      // (e.g. switch tab, then switch range). `TK_CLICK_WAIT` shortens the pause
      // after each click so transient states (entrance animations) can be caught.
      const click = process.env['TK_CLICK']
      const clickWait = Number(process.env['TK_CLICK_WAIT'] ?? '2500')
      if (click) {
        for (const step of click.split(';')) {
          const [cx, cy] = step.split(',').map(Number)
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue
          win.webContents.sendInputEvent({ type: 'mouseMove', x: cx!, y: cy! })
          win.webContents.sendInputEvent({ type: 'mouseDown', x: cx!, y: cy!, button: 'left', clickCount: 1 })
          win.webContents.sendInputEvent({ type: 'mouseUp', x: cx!, y: cy!, button: 'left', clickCount: 1 })
          await new Promise((r) => setTimeout(r, clickWait))
        }
      }
      // `TK_HOVER=x,y` moves the pointer so hover/tooltip states can be captured.
      const hover = process.env['TK_HOVER']
      if (hover) {
        const [hx, hy] = hover.split(',').map(Number)
        if (Number.isFinite(hx) && Number.isFinite(hy)) {
          win.webContents.sendInputEvent({ type: 'mouseMove', x: hx!, y: hy! })
          await new Promise((r) => setTimeout(r, 700))
        }
      }
      const img = await win.webContents.capturePage()
      await writeFile(snapshot, img.toPNG())
      console.log('snapshot written:', snapshot)
      app.exit(0)
    }, 11000)
  }
  return win
}

app.whenReady().then(async () => {
  ipcMain.handle('tk:scan', async (_e, range: RangeKey): Promise<ScanResult> => {
    try {
      const dashboard = await scanAll(range)
      return { ok: true, dashboard }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('tk:openPath', async (_e, p: string): Promise<void> => {
    if (typeof p !== 'string' || p.length === 0) return
    await shell.openPath(p)
  })
  // Opening the price list creates it from the built-in defaults on first use,
  // so "edit my prices" is always a single click away.
  ipcMain.handle('tk:editPricing', async (): Promise<void> => {
    const file = await writeDefaultPricingFileIfMissing()
    await shell.openPath(file)
  })

  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
