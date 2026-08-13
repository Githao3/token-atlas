import type {
  AdapterSlice,
  CacheStats,
  CostBreakdown,
  Dashboard,
  DashboardStats,
  DayModelPoint,
  HeatCell,
  ModelSlice,
  ProjectSlice,
  RangeKey,
  UsageRecord
} from '@shared/types'
import { dayKey } from './scan/util'
import { projectLabel } from './scan/normalize'
import { costOf, loadPricing, type PricingTable } from './pricing'
import { scanZcode, type AdapterOutput } from './adapters/zcode'
import { scanClaude } from './adapters/claude'
import { scanCodex } from './adapters/codex'
import { scanOpencode } from './adapters/opencode'

const DAY_MS = 24 * 60 * 60 * 1000
/** 53 weeks — a full-year contribution grid, same shape as the pic/ reference. */
const HEAT_DAYS = 371

export async function scanAll(range: RangeKey): Promise<Dashboard> {
  const [pricing, zcode, claude, codex, opencode] = await Promise.all([
    loadPricing(),
    scanZcode(),
    scanClaude(),
    scanCodex(),
    scanOpencode()
  ])
  return aggregate([zcode, claude, codex, opencode], range, pricing)
}

function rangeStart(range: RangeKey, now: Date): number | null {
  switch (range) {
    case '7d':
      return now.getTime() - 7 * DAY_MS
    case '30d':
      return now.getTime() - 30 * DAY_MS
    case '90d':
      return now.getTime() - 90 * DAY_MS
    case 'all':
      return null
  }
}

function aggregate(outputs: AdapterOutput[], range: RangeKey, pricing: PricingTable): Dashboard {
  const now = new Date()
  const cutoff = rangeStart(range, now)

  const inRange: UsageRecord[] = []
  const adapters: AdapterSlice[] = []
  const unmatched = new Set<string>()
  // Trailing-window activity, independent of the selected range, for the heatmap.
  const heatTotal = new Map<string, number>()
  const heatTurns = new Map<string, number>()
  let earliestTs = Number.POSITIVE_INFINITY

  for (const o of outputs) {
    let total = 0
    let cost = 0
    let messages = 0
    const sessions = new Set<string>()
    for (const r of o.records) {
      const ts = Date.parse(r.ts)
      if (!Number.isFinite(ts)) continue
      const { rate, matched } = pricing.rateFor(r.model)
      if (!matched) unmatched.add(r.model)
      const recCost = costOf(rate, r)
      const day = dayKey(new Date(ts))
      if (ts < earliestTs) earliestTs = ts
      heatTotal.set(day, (heatTotal.get(day) ?? 0) + r.total)
      heatTurns.set(day, (heatTurns.get(day) ?? 0) + 1)
      if (cutoff != null && ts < cutoff) continue
      const rec: UsageRecord = { ...r, day, cost: recCost }
      inRange.push(rec)
      total += rec.total
      cost += recCost
      messages++
      if (rec.sessionId) sessions.add(rec.sessionId)
    }
    adapters.push({
      adapter: o.adapter,
      label: o.label,
      total,
      cost,
      sessions: sessions.size || o.sessionHint || 0,
      messages,
      available: o.available,
      rootPath: o.rootPath,
      error: o.error
    })
  }

  const models = rollupModels(inRange, pricing)
  const projects = rollupProjects(inRange)
  const cache = rollupCache(inRange, pricing)
  const cost = rollupCost(inRange, pricing)

  // Per-day-per-model, per-day sets.
  const dayModel = new Map<string, DayModelPoint>()
  const daySet = new Set<string>()
  const sessionSet = new Set<string>()
  for (const r of inRange) {
    const day = r.day!
    daySet.add(day)
    if (r.sessionId) sessionSet.add(r.sessionId)
    const key = `${day}\x00${r.model}`
    const existing = dayModel.get(key)
    if (existing) existing.total += r.total
    else dayModel.set(key, { day, model: r.model, total: r.total })
  }
  const perDay = [...dayModel.values()].sort((a, b) => a.day.localeCompare(b.day))

  // Heatmap: trailing full-year window (extends back for `all`).
  const heatEndDate = new Date(now)
  heatEndDate.setHours(0, 0, 0, 0)
  let heatStartDate = new Date(heatEndDate.getTime() - (HEAT_DAYS - 1) * DAY_MS)
  if (range === 'all' && Number.isFinite(earliestTs)) {
    const earliest = new Date(earliestTs)
    earliest.setHours(0, 0, 0, 0)
    if (earliest.getTime() < heatStartDate.getTime()) heatStartDate = earliest
  }
  const heatmap: HeatCell[] = []
  for (let t = heatStartDate.getTime(); t <= heatEndDate.getTime(); t += DAY_MS) {
    const d = dayKey(new Date(t))
    heatmap.push({ day: d, total: heatTotal.get(d) ?? 0, turns: heatTurns.get(d) ?? 0 })
  }

  // Streak: consecutive days ending today (or yesterday) with any activity.
  let streak = 0
  let cursor = heatEndDate.getTime()
  if ((heatTotal.get(dayKey(new Date(cursor))) ?? 0) === 0) cursor -= DAY_MS
  for (; streak <= 3650; cursor -= DAY_MS) {
    if ((heatTotal.get(dayKey(new Date(cursor))) ?? 0) > 0) streak++
    else break
  }

  const favorite = models[0]
  const stats: DashboardStats = {
    totalTokens: sum(inRange, (r) => r.total),
    totalCost: cost.total,
    sessions: sessionSet.size || adapters.reduce((s, a) => s + a.sessions, 0),
    messages: inRange.length,
    activeDays: daySet.size,
    currentStreak: streak,
    cacheHitRate: cache.hitRate,
    favoriteModel: favorite ? { model: favorite.model, share: favorite.share } : null
  }

  return {
    range,
    generatedAt: now.toISOString(),
    stats,
    models,
    adapters,
    projects,
    cache,
    cost,
    perDay,
    heatmap,
    heatStart: dayKey(heatStartDate),
    heatEnd: dayKey(heatEndDate),
    pricing: {
      path: pricing.path,
      usingOverrides: pricing.usingOverrides,
      unmatchedModels: [...unmatched].sort()
    }
  }
}

function rollupModels(records: UsageRecord[], pricing: PricingTable): ModelSlice[] {
  const byModel = new Map<
    string,
    { total: number; freshInput: number; cacheRead: number; output: number; cost: number; fallback: boolean }
  >()
  for (const r of records) {
    const { matched } = pricing.rateFor(r.model)
    const m =
      byModel.get(r.model) ??
      { total: 0, freshInput: 0, cacheRead: 0, output: 0, cost: 0, fallback: !matched }
    m.total += r.total
    m.freshInput += r.freshInputTokens
    m.cacheRead += r.cacheReadTokens
    m.output += r.outputTokens
    m.cost += r.cost
    byModel.set(r.model, m)
  }
  const grand = [...byModel.values()].reduce((s, v) => s + v.total, 0)
  return [...byModel.entries()]
    .map(([model, v]) => ({
      model,
      total: v.total,
      freshInput: v.freshInput,
      cacheRead: v.cacheRead,
      output: v.output,
      cost: v.cost,
      share: grand > 0 ? v.total / grand : 0,
      pricingFallback: v.fallback
    }))
    .sort((a, b) => b.total - a.total)
}

function rollupProjects(records: UsageRecord[]): ProjectSlice[] {
  const byPath = new Map<
    string,
    { total: number; cost: number; sessions: Set<string>; messages: number; adapters: Set<string> }
  >()
  let grand = 0
  for (const r of records) {
    if (!r.project) continue
    grand += r.total
    const p =
      byPath.get(r.project) ??
      { total: 0, cost: 0, sessions: new Set<string>(), messages: 0, adapters: new Set<string>() }
    p.total += r.total
    p.cost += r.cost
    p.messages++
    p.adapters.add(r.adapter)
    if (r.sessionId) p.sessions.add(r.sessionId)
    byPath.set(r.project, p)
  }
  return [...byPath.entries()]
    .map(([path, v]) => ({
      path,
      label: projectLabel(path),
      total: v.total,
      cost: v.cost,
      sessions: v.sessions.size,
      messages: v.messages,
      share: grand > 0 ? v.total / grand : 0,
      adapters: [...v.adapters] as ProjectSlice['adapters']
    }))
    .sort((a, b) => b.total - a.total)
}

function rollupCache(records: UsageRecord[], pricing: PricingTable): CacheStats {
  let readTokens = 0
  let writeTokens = 0
  let freshInputTokens = 0
  let costWithCache = 0
  let costWithoutCache = 0
  for (const r of records) {
    const { rate } = pricing.rateFor(r.model)
    readTokens += r.cacheReadTokens
    writeTokens += r.cacheWriteTokens
    freshInputTokens += r.freshInputTokens
    costWithCache += r.cost
    // Counterfactual: had every cached prompt token been billed at the full input rate.
    const noCache = costOf(rate, {
      freshInputTokens: r.freshInputTokens + r.cacheReadTokens + r.cacheWriteTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: r.outputTokens
    })
    costWithoutCache += noCache
  }
  const promptTotal = readTokens + freshInputTokens
  return {
    readTokens,
    writeTokens,
    freshInputTokens,
    hitRate: promptTotal > 0 ? readTokens / promptTotal : 0,
    costWithoutCache,
    costWithCache,
    saved: Math.max(0, costWithoutCache - costWithCache)
  }
}

function rollupCost(records: UsageRecord[], pricing: PricingTable): CostBreakdown {
  const b: CostBreakdown = { freshInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }
  for (const r of records) {
    const { rate } = pricing.rateFor(r.model)
    const fi = (r.freshInputTokens * rate.input) / 1e6
    const cr = (r.cacheReadTokens * rate.cacheRead) / 1e6
    const cw = (r.cacheWriteTokens * rate.cacheWrite) / 1e6
    const ou = (r.outputTokens * rate.output) / 1e6
    b.freshInput += fi
    b.cacheRead += cr
    b.cacheWrite += cw
    b.output += ou
    b.total += fi + cr + cw + ou
  }
  return b
}

function sum(records: UsageRecord[], pick: (r: UsageRecord) => number): number {
  let s = 0
  for (const r of records) s += pick(r)
  return s
}
