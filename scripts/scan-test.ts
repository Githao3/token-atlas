/**
 * Headless smoke test for the adapters + aggregator. Runs the exact same code
 * paths the Electron main process uses, but in plain Node so we can validate
 * against real on-disk data before wiring the UI.
 *
 *   npm run scan:test
 */
import { scanAll } from '../electron/aggregate'
import type { RangeKey } from '../src/shared/types'

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

async function run(): Promise<void> {
  for (const range of ['30d', 'all'] as RangeKey[]) {
    const d = await scanAll(range)
    console.log(`\n================  range = ${range}  ================`)
    console.log('total tokens :', fmt(d.stats.totalTokens))
    console.log('total cost   : $' + d.stats.totalCost.toFixed(2))
    console.log('sessions     :', d.stats.sessions)
    console.log('messages     :', d.stats.messages)
    console.log('active days  :', d.stats.activeDays)
    console.log('streak       :', d.stats.currentStreak)
    console.log('cache hit    :', (d.stats.cacheHitRate * 100).toFixed(1) + '%')
    console.log('cache saved  : $' + d.cache.saved.toFixed(2))
    console.log('favorite     :', d.stats.favoriteModel)
    console.log('cost split   :', {
      freshInput: +d.cost.freshInput.toFixed(2),
      cacheRead: +d.cost.cacheRead.toFixed(2),
      cacheWrite: +d.cost.cacheWrite.toFixed(2),
      output: +d.cost.output.toFixed(2)
    })
    console.log('adapters:')
    for (const a of d.adapters) {
      console.log(
        `  - ${a.label.padEnd(12)} avail=${a.available} tokens=${fmt(a.total).padStart(7)} ` +
          `cost=$${a.cost.toFixed(2).padStart(8)} sessions=${a.sessions} msgs=${a.messages}` +
          `${a.error ? '  ERR=' + a.error : ''}`
      )
    }
    console.log('top models:')
    for (const m of d.models.slice(0, 6)) {
      console.log(
        `  - ${m.model.padEnd(22)} ${fmt(m.total).padStart(7)}  ${(m.share * 100).toFixed(1)}%  ` +
          `$${m.cost.toFixed(2).padStart(8)}${m.pricingFallback ? '  (no price rule)' : ''}`
      )
    }
    console.log('top projects:')
    for (const p of d.projects.slice(0, 6)) {
      console.log(
        `  - ${p.label.padEnd(18)} ${fmt(p.total).padStart(7)}  $${p.cost.toFixed(2).padStart(8)}  ` +
          `${p.sessions} sessions  [${p.adapters.join(',')}]  ${p.path}`
      )
    }
    console.log('pricing      :', d.pricing.path, 'overrides=' + d.pricing.usingOverrides)
    if (d.pricing.unmatchedModels.length > 0) {
      console.log('  no price rule for:', d.pricing.unmatchedModels.join(', '))
    }
    console.log(`heatmap cells: ${d.heatmap.length} (${d.heatStart} .. ${d.heatEnd})`)
    console.log(`perDay points: ${d.perDay.length}`)
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
