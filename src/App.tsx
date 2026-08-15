import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Dashboard, RangeKey } from '@shared/types'
import { Overview } from './components/Overview'
import { Trends } from './components/Trends'
import { ThreeDLab } from './components/ThreeDLab'
import { useI18n } from './lib/i18n'

type Tab = 'overview' | 'trend' | '3d-lab'
type Theme = 'dark' | 'light'
const RANGES: RangeKey[] = ['7d', '30d', '90d', 'all']
const THEME_KEY = 'tk.theme'
const SRC_KEY = 'tk.sources.open'

export function App() {
  const { t, lang, setLang } = useI18n()
  const [tab, setTab] = useState<Tab>('overview')
  const [range, setRange] = useState<RangeKey>('30d')
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'dark'
  )
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Collapsed state sticks, so the rail stays how the user left it.
  const [srcOpen, setSrcOpen] = useState(() => localStorage.getItem(SRC_KEY) !== '0')

  useEffect(() => {
    localStorage.setItem(SRC_KEY, srcOpen ? '1' : '0')
  }, [srcOpen])

  /** Biggest contributor first — the rail's fixed adapter order buried opencode
      below two sources a hundred times smaller. */
  const sources = useMemo(
    () => (data ? [...data.adapters].sort((a, b) => b.total - a.total) : []),
    [data]
  )

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
      else setError(res.error ?? t('err.unknown'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [t])

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
              <small>{t('brand.tagline')}</small>
            </div>
          </div>
          <nav>
            <div className="rail-label">{t('nav.analysis')}</div>
            <button className="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
              <span className="dot" /> {t('nav.overview')}
            </button>
            <button className="tab" aria-selected={tab === 'trend'} onClick={() => setTab('trend')}>
              <span className="dot" /> {t('nav.trends')}
            </button>
            <button className="tab" aria-selected={tab === '3d-lab'} onClick={() => setTab('3d-lab')}>
              <span className="dot" /> {t('nav.lab')}
            </button>
          </nav>
          {data && (
            <div className="sources">
              <button
                className="rail-label rail-fold"
                aria-expanded={srcOpen}
                onClick={() => setSrcOpen((v) => !v)}
              >
                {t('rail.sources')}
                <span className="count">{sources.length}</span>
                <span className="chev" aria-hidden="true" />
              </button>
              {srcOpen &&
                sources.map((a) => (
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
            <h2>{t('top.title')}</h2>
            <span className="sub">
              {data ? t('top.sources', { n: data.adapters.filter((a) => a.available).length }) : '...'}
            </span>
            <div className="spacer" />
            {/* The 3D Lab is a fixed trailing-year view, so the range picker
                would be a dead control there. */}
            {tab !== '3d-lab' && (
              <div className="seg" role="group" aria-label={t('range.aria')}>
                {RANGES.map((k) => (
                  <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>
                    {t(`range.${k}`)}
                  </button>
                ))}
              </div>
            )}

            <button className="icon-btn" onClick={() => doScan(range)} title={t('btn.refresh')} disabled={loading}>
              ↻
            </button>
            <button
              className="icon-btn lang-btn"
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              title={t('btn.lang')}
              aria-label={t('btn.lang')}
            >
              {lang === 'zh' ? 'EN' : '中'}
            </button>
            <button className="icon-btn" onClick={toggleTheme} title={t('btn.theme')}>
              ◐
            </button>
          </header>

          {loading && !data && (
            <div className="center-state">
              <div className="spinner" />
              <p>{t('state.scanning')}</p>
            </div>
          )}
          {error && !data && (
            <div className="center-state">
              <h3>{t('state.scanFailed')}</h3>
              <span className="tag-err">{error}</span>
            </div>
          )}
          {data && tab === 'overview' && <Overview data={data} loading={loading} themeKey={theme} />}
          {data && tab === 'trend' && <Trends data={data} loading={loading} themeKey={theme} />}
          {data && tab === '3d-lab' && <ThreeDLab data={data} themeKey={theme} />}
          {!data && tab === '3d-lab' && (
            <div className="center-state">
              <div className="spinner" />
              <p>{t('state.scanning')}</p>
            </div>
          )}
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
