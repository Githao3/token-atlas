import type { Dashboard } from '@shared/types'
import { StatCards } from './StatCards'
import { Heatmap } from './Heatmap'
import { TokensPerDay } from './TokensPerDay'
import { ModelUsage } from './ModelUsage'
import { Projects } from './Projects'
import { CostAndCache } from './CostAndCache'
import { AdapterBreakdown } from './AdapterBreakdown'

interface Props {
  data: Dashboard
  loading: boolean
  /** Bumped on theme change so the child ECharts re-init to pick up CSS vars. */
  themeKey: string
}

export function Overview({ data, loading, themeKey }: Props) {
  return (
    <div className="fade-in" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .3s' }}>
      <StatCards data={data} />
      <div className="row">
        <Heatmap data={data} />
      </div>
      <CostAndCache data={data} />
      <div className="row">
        <TokensPerDay data={data} themeKey={themeKey} />
      </div>
      <div className="row">
        <Projects data={data} themeKey={themeKey} />
      </div>
      <div className="row">
        <ModelUsage data={data} themeKey={themeKey} />
      </div>
      <div className="row">
        <AdapterBreakdown data={data} />
      </div>
    </div>
  )
}
