import type { Dashboard } from '@shared/types'
import { fmt, money } from '../lib/format'

interface Props {
  data: Dashboard
}

/**
 * Cache efficiency + cost composition. Both are estimates derived from the
 * editable price list, so the panel says so explicitly.
 */
export function CostAndCache({ data }: Props) {
  const c = data.cache
  const cost = data.cost
  const parts = [
    { key: 'Fresh input', value: cost.freshInput, color: 'var(--m0)' },
    { key: 'Cache read', value: cost.cacheRead, color: 'var(--m1)' },
    { key: 'Cache write', value: cost.cacheWrite, color: 'var(--m2)' },
    { key: 'Output', value: cost.output, color: 'var(--m4)' }
  ]
  const maxPart = Math.max(...parts.map((p) => p.value), 1e-9)

  return (
    <div className="row split-cost">
      {/* cache efficiency */}
      <div className="panel">
        <div className="panel-head">
          <h3>Cache efficiency</h3>
          <span className="note">PROMPT REUSE</span>
        </div>
        <div className="gauge">
          <div className="gauge-num">
            {(c.hitRate * 100).toFixed(1)}
            <span>%</span>
          </div>
          <div className="gauge-bar">
            <span style={{ width: `${Math.min(c.hitRate * 100, 100)}%` }} />
          </div>
          <div className="gauge-cap">
            {fmt(c.readTokens)} 命中 / {fmt(c.readTokens + c.freshInputTokens)} 提示词
          </div>
        </div>
        <div className="kv">
          <Row k="缓存命中 token" v={fmt(c.readTokens)} />
          <Row k="未命中（新提示词）" v={fmt(c.freshInputTokens)} />
          <Row k="写入缓存 token" v={fmt(c.writeTokens)} />
          <Row k="不用缓存需花费" v={money(c.costWithoutCache)} />
          <Row k="实际花费" v={money(c.costWithCache)} />
          <Row k="节省" v={money(c.saved)} strong />
        </div>
      </div>

      {/* cost composition */}
      <div className="panel">
        <div className="panel-head">
          <h3>Cost breakdown</h3>
          <button className="link-btn" onClick={() => window.tk.editPricing()}>
            编辑单价 ↗
          </button>
        </div>
        <div className="cost-total">
          {money(cost.total)}
          <small>估算总花费 · {data.pricing.usingOverrides ? '使用自定义单价' : '使用内置默认单价'}</small>
        </div>
        <div className="kv">
          {parts.map((p) => (
            <div className="kv-row" key={p.key}>
              <span className="kv-k">{p.key}</span>
              <span className="kv-track">
                <span style={{ width: `${(p.value / maxPart) * 100}%`, background: p.color }} />
              </span>
              <span className="kv-v">{money(p.value)}</span>
            </div>
          ))}
        </div>
        <p className="disclaimer">
          单价为估算默认值，未必与你的实际账单一致。点「编辑单价」可改写{' '}
          <code>~/.token-atlas/pricing.json</code>。
          {data.pricing.unmatchedModels.length > 0 && (
            <>
              {' '}
              以下模型没有匹配规则，按兜底价计算：
              <b>{data.pricing.unmatchedModels.join('、')}</b>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="kv-row plain">
      <span className="kv-k">{k}</span>
      <span className="kv-v" style={strong ? { color: 'var(--m1)', fontWeight: 600 } : undefined}>
        {v}
      </span>
    </div>
  )
}
