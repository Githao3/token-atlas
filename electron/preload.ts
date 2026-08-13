import { contextBridge, ipcRenderer } from 'electron'
import type { RangeKey, ScanResult, TkApi } from '@shared/types'

const api: TkApi = {
  scan: (range: RangeKey) => ipcRenderer.invoke('tk:scan', range) as Promise<ScanResult>,
  openPath: (p: string) => ipcRenderer.invoke('tk:openPath', p) as Promise<void>,
  editPricing: () => ipcRenderer.invoke('tk:editPricing') as Promise<void>
}

contextBridge.exposeInMainWorld('tk', api)
