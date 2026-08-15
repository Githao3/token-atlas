import { useMemo } from 'react'
import type { Dashboard, HeatCell } from '@shared/types'
import { fmt, cssVar } from '../lib/format'
import { MONTHS, useI18n } from '../lib/i18n'

interface Props {
  data: Dashboard
}

const LEVELS = 5

/**
 * Calendar-style heatmap matching the reference in pic/4.png: weeks as columns,
 * Monday → Sunday top to bottom, columns flexing to fill the panel width.
 */
export function Heatmap({ data }: Props) {
  const { t, lang } = useI18n()
  const { weeks, months, maxTokens } = useMemo(() => {
    const cells = data.heatmap
    let max = 0
    for (const c of cells) if (c.total > max) max = c.total

    // Pad the first column so the grid starts on the correct weekday.
    const weeks: Array<Array<HeatCell | null>> = []
    let col: Array<HeatCell | null> = []
    const start = new Date((cells[0]?.day ?? data.heatStart) + 'T00:00:00')
    const startWeekday = (start.getDay() + 6) % 7 // 0 = Monday
    for (let i = 0; i < startWeekday; i++) col.push(null)
    for (const c of cells) {
      col.push(c)
      if (col.length === 7) {
        weeks.push(col)
        col = []
      }
    }
    if (col.length > 0) {
      while (col.length < 7) col.push(null)
      weeks.push(col)
    }

    // Month ruler: label a column only when its first real day starts a new month.
    let lastMonth = -1
    const months = weeks.map((w) => {
      const first = w.find((c): c is HeatCell => c !== null)
      if (!first) return ''
      const m = Number(first.day.slice(5, 7)) - 1
      if (m === lastMonth) return ''
      lastMonth = m
      return MONTHS[lang][m] ?? ''
    })

    return { weeks, months, maxTokens: max }
  }, [data.heatmap, data.heatStart, lang])

  function color(level: number): string {
    if (level <= 0) return 'var(--heat-empty)'
    const accent = cssVar('--accent')
    const pct = Math.round((0.2 + (level / LEVELS) * 0.8) * 100)
    return `color-mix(in srgb, ${accent} ${pct}%, transparent)`
  }

  function level(total: number): number {
    if (total <= 0 || maxTokens <= 0) return 0
    return Math.min(Math.ceil((total / maxTokens) * LEVELS), LEVELS)
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{t('heat.title')}</h3>
        <div className="heat-legend">
          {t('heat.less')}
          {Array.from({ length: LEVELS + 1 }, (_, i) => (
            <i key={i} style={{ background: color(i) }} />
          ))}
          {t('heat.more')}
        </div>
      </div>
      <div className="heat-months">
        {months.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
      <div className="heat">
        {weeks.map((w, wi) => (
          <div className="heat-col" key={wi}>
            {w.map((c, ci) =>
              c === null ? (
                <div key={ci} className="heat-cell empty-slot" />
              ) : (
                <div
                  key={ci}
                  className="heat-cell"
                  style={{ background: color(level(c.total)) }}
                  title={t('heat.tip', { day: c.day, tokens: fmt(c.total), n: c.turns })}
                />
              )
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
