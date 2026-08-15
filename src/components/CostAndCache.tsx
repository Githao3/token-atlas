import type { Dashboard } from '@shared/types'
import { fmt, money } from '../lib/format'
import { useI18n } from '../lib/i18n'

interface Props {
  data: Dashboard
}

/**
 * Cache efficiency + cost composition. Both are estimates derived from the
 * editable price list, so the panel says so explicitly.
 */
export function CostAndCache({ data }: Props) {
  const { t } = useI18n()
  const c = data.cache
  const cost = data.cost
  const parts = [
    { key: t('cost.freshInput'), value: cost.freshInput, color: 'var(--m0)' },
    { key: t('cost.cacheRead'), value: cost.cacheRead, color: 'var(--m1)' },
    { key: t('cost.cacheWrite'), value: cost.cacheWrite, color: 'var(--m2)' },
    { key: t('cost.output'), value: cost.output, color: 'var(--m4)' }
  ]
  const maxPart = Math.max(...parts.map((p) => p.value), 1e-9)

  return (
    <div className="row split-cost">
      {/* cache efficiency */}
      <div className="panel">
        <div className="panel-head">
          <h3>{t('cache.title')}</h3>
          <span className="note">{t('cache.note')}</span>
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
            {t('cache.gauge', {
              hit: fmt(c.readTokens),
              total: fmt(c.readTokens + c.freshInputTokens)
            })}
          </div>
        </div>
        <div className="kv">
          <Row k={t('cache.readTokens')} v={fmt(c.readTokens)} />
          <Row k={t('cache.fresh')} v={fmt(c.freshInputTokens)} />
          <Row k={t('cache.writeTokens')} v={fmt(c.writeTokens)} />
          <Row k={t('cache.withoutCache')} v={money(c.costWithoutCache)} />
          <Row k={t('cache.actual')} v={money(c.costWithCache)} />
          <Row k={t('cache.saved')} v={money(c.saved)} strong />
        </div>
      </div>

      {/* cost composition */}
      <div className="panel">
        <div className="panel-head">
          <h3>{t('cost.title')}</h3>
          <button className="link-btn" onClick={() => window.tk.editPricing()}>
            {t('cost.editRates')}
          </button>
        </div>
        <div className="cost-total">
          {money(cost.total)}
          <small>
            {t('cost.totalSub', {
              mode: data.pricing.usingOverrides ? t('cost.custom') : t('cost.builtin')
            })}
          </small>
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
          {t('cost.disclaimer')} <code>~/.token-atlas/pricing.json</code>{t('cost.disclaimerEnd')}
          {data.pricing.unmatchedModels.length > 0 && (
            <>
              {' '}
              {t('cost.unmatched')}
              <b>{data.pricing.unmatchedModels.join(data.pricing.unmatchedModels.length > 3 ? ', ' : '、')}</b>
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
