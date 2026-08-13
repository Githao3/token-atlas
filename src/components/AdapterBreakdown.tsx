import type { Dashboard } from '@shared/types'
import { fmt, money } from '../lib/format'

interface Props {
  data: Dashboard
}

export function AdapterBreakdown({ data }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Adapter breakdown</h3>
        <span className="note">DATA SOURCES</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {data.adapters.map((a) => (
          <div
            key={a.adapter}
            className="stat"
            style={{ cursor: a.available ? 'pointer' : 'default' }}
            onClick={() => a.available && window.tk.openPath(a.rootPath)}
            title={a.available ? `打开 ${a.rootPath}` : '未找到数据'}
          >
            <div className="k">
              <span style={{ color: a.available ? 'var(--m1)' : 'var(--muted)' }}>{a.available ? '●' : '○'}</span>
              {a.label}
            </div>
            <div className="v small">{a.available ? fmt(a.total) : '—'}</div>
            {a.available && (
              <div className="sub">
                {money(a.cost)} · {a.sessions} sessions · {a.messages} messages
              </div>
            )}
            {a.error && <div className="sub" style={{ color: 'var(--m3)' }}>{a.error}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
