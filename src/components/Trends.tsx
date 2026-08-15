import type { Dashboard } from '@shared/types'
import { CostTrend } from './CostTrend'
import { ModelTrend } from './ModelTrend'

interface Props {
  data: Dashboard
  loading: boolean
  themeKey: string
}

/**
 * Trends — the time-series view, split out of the overview so the line charts
 * get the full page instead of a 380px slot between two dense panels.
 * Follows the range picker at the top of the app.
 */
export function Trends({ data, loading, themeKey }: Props) {
  return (
    <div className="fade-in" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .3s' }}>
      <div className="row">
        <CostTrend data={data} themeKey={themeKey} />
      </div>
      <div className="row">
        <ModelTrend data={data} themeKey={themeKey} />
      </div>
    </div>
  )
}
