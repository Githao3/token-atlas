import { useMemo } from 'react'
import type { Dashboard } from '@shared/types'
import { EChart } from './EChart'
import { fmt, money, cssVar } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

const ADAPTER_LABEL: Record<string, string> = {
  zcode: 'ZCode',
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'opencode'
}

/**
 * Per-project (working directory) rollup. Horizontal bars ranked by tokens,
 * with cost and session counts. Clicking a row opens that folder.
 */
export function Projects({ data, themeKey }: Props) {
  // Same count on both sides so the bars line up with the list rows. Height is
  // derived from the count and shared by both columns, which is what keeps them
  // level — the chart used to be a fixed 380px while the list grew with its rows.
  const N = 10
  const ROW_PX = 54
  const top = data.projects.slice(0, N)
  const bodyH = top.length * ROW_PX

  const option = useMemo(() => {
    const rows = [...top].reverse() // ECharts y-axis draws bottom-up
    return {
      grid: { top: 8, bottom: 8, left: 8, right: 90, containLabel: true },
      tooltip: {
        trigger: 'item' as const,
        appendToBody: true,
        confine: true,
        backgroundColor: cssVar('--panel-solid'),
        borderColor: cssVar('--panel-brd'),
        textStyle: { color: cssVar('--ink'), fontFamily: 'var(--font-mono)', fontSize: 11 },
        formatter: (p: { name: string; value: number; dataIndex: number }) => {
          const proj = rows[p.dataIndex]
          return `${proj?.path ?? p.name}<br/>${fmt(p.value)} tokens · ${money(proj?.cost ?? 0)} · ${proj?.sessions ?? 0} sessions`
        }
      },
      xAxis: {
        type: 'value' as const,
        axisLabel: { color: cssVar('--muted'), fontSize: 10, fontFamily: 'var(--font-mono)', formatter: (v: number) => fmt(v) },
        splitLine: { lineStyle: { color: cssVar('--line'), type: 'dashed' as const } }
      },
      yAxis: {
        type: 'category' as const,
        data: rows.map((r) => r.label),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: cssVar('--line') } },
        axisLabel: { color: cssVar('--ink-soft'), fontSize: 12, fontFamily: 'var(--font-mono)' }
      },
      series: [
        {
          type: 'bar' as const,
          data: rows.map((r) => r.total),
          barWidth: '62%',
          itemStyle: { color: cssVar('--accent'), borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: 'right' as const,
            color: cssVar('--muted'),
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            formatter: (p: { dataIndex: number }) => money(rows[p.dataIndex]?.cost ?? 0)
          }
        }
      ]
    }
  }, [top, themeKey])

  if (top.length === 0) {
    return (
      <div className="panel">
        <div className="panel-head">
          <h3>Projects</h3>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>没有可归类的项目路径（数据源未记录工作目录）。</p>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Projects</h3>
        <span className="note">BY WORKING DIR</span>
      </div>
      <div className="proj-split" style={{ height: bodyH }}>
        <EChart option={option} className="proj-chart" themeKey={themeKey} />
        <div className="mlist proj-list">
          {top.map((p) => (
            <div
              className="mrow"
              key={p.path}
              style={{ cursor: 'pointer' }}
              onClick={() => window.tk.openPath(p.path)}
              title={`打开 ${p.path}`}
            >
              <span className="swatch" style={{ background: 'var(--accent)' }} />
              <span className="name">{p.label}</span>
              <span className="pct">{money(p.cost)}</span>
              <span className="amt">
                {fmt(p.total)} tokens · {p.sessions} sessions ·{' '}
                {p.adapters.map((a) => ADAPTER_LABEL[a] ?? a).join(' / ')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
