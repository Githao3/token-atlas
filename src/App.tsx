import { useState, useEffect, useCallback } from 'react'
import type { Dashboard, RangeKey } from '@shared/types'
import { Overview } from './components/Overview'
import { ThreeDLab } from './components/ThreeDLab'

type Tab = 'overview' | '3d-lab'
type Theme = 'dark' | 'light'
const RANGE_LABELS: Record<RangeKey, string> = { '7d': '7 天', '30d': '30 天', '90d': '90 天', all: '全部' }
const THEME_KEY = 'tk.theme'

export function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [range, setRange] = useState<RangeKey>('30d')
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'dark'
  )
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Keep the DOM attribute in sync so all CSS custom properties switch at once.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const doScan = useCallback(async (r: RangeKey) => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.tk.scan(r)
      if (res.ok && res.dashboard) setData(res.dashboard)
      else setError(res.error ?? '未知错误')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { doScan(range) }, [range, doScan])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return (
    <>
      <div className="backdrop" />
      <div className="shell">
        {/* left rail */}
        <aside className="rail">
          <div className="brand">
            <div className="mark" />
            <div>
              <h1>Token Atlas</h1>
              <small>local insight</small>
            </div>
          </div>
          <nav>
            <div className="rail-label">Analysis</div>
            <button className="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
              <span className="dot" /> 总览 Overview
            </button>
            <button className="tab" aria-selected={tab === '3d-lab'} onClick={() => setTab('3d-lab')}>
              <span className="dot" /> 3D Lab <span className="soon">SOON</span>
            </button>
          </nav>
          {data && (
            <div className="sources">
              <div className="rail-label">Sources</div>
              {data.adapters.map((a) => (
                <button
                  key={a.adapter}
                  className={`src ${a.available ? 'on' : ''}`}
                  onClick={() => a.available && window.tk.openPath(a.rootPath)}
                  title={a.rootPath}
                >
                  <span className="pip" />
                  {a.label}
                  <span className="amt">{fmtCompact(a.total)}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* main pane */}
        <main className="main">
          <header className="topbar">
            <h2>Token 用量</h2>
            <span className="sub">{data ? `${data.adapters.filter((a) => a.available).length} sources` : '...'}</span>
            <div className="spacer" />
            <div className="seg" role="group" aria-label="时间范围">
              {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
                <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>
                  {RANGE_LABELS[k]}
                </button>
              ))}
            </div>
            <button className="icon-btn" onClick={() => doScan(range)} title="刷新" disabled={loading}>
              ↻
            </button>
            <button className="icon-btn" onClick={toggleTheme} title="切换主题">
              ◐
            </button>
          </header>

          {loading && !data && (
            <div className="center-state">
              <div className="spinner" />
              <p>正在扫描本地 AI agent 数据…</p>
            </div>
          )}
          {error && !data && (
            <div className="center-state">
              <h3>扫描失败</h3>
              <span className="tag-err">{error}</span>
            </div>
          )}
          {data && tab === 'overview' && <Overview data={data} loading={loading} themeKey={theme} />}
          {tab === '3d-lab' && <ThreeDLab />}
        </main>
      </div>
    </>
  )
}

function fmtCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}
