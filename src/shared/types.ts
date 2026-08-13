// Shared types between Electron main and renderer.

/** Which agent produced the record. */
export type AdapterId = 'zcode' | 'claude' | 'codex' | 'opencode'

/**
 * A single normalized token-usage event.
 *
 * Token kinds are split because they are billed very differently. Adapters
 * normalize their native fields into these four buckets, which always sum to
 * `total`:
 *   freshInput + cacheRead + cacheWrite + output === total
 */
export interface UsageRecord {
  adapter: AdapterId
  /** ISO timestamp of the model response. */
  ts: string
  /** Local day key YYYY-MM-DD (computed in aggregator). */
  day?: string
  model: string
  /** Uncached prompt tokens — billed at the full input rate. */
  freshInputTokens: number
  /** Prompt tokens served from cache — typically ~10x cheaper. */
  cacheReadTokens: number
  /** Tokens written into the cache — usually a premium over input. */
  cacheWriteTokens: number
  outputTokens: number
  /** Reasoning tokens if reported separately (already inside output for most providers). */
  reasoningTokens: number
  total: number
  /** Estimated USD cost, computed by the aggregator from the pricing table. */
  cost: number
  /** Session identifier if the source exposes one. */
  sessionId?: string
  /** Working directory / project this request belonged to. */
  project?: string
}

export interface CostBreakdown {
  freshInput: number
  cacheRead: number
  cacheWrite: number
  output: number
  total: number
}

export interface ModelSlice {
  model: string
  total: number
  freshInput: number
  cacheRead: number
  output: number
  cost: number
  share: number // 0..1
  /** True when no pricing rule matched and the fallback rate was used. */
  pricingFallback: boolean
}

export interface AdapterSlice {
  adapter: AdapterId
  label: string
  total: number
  cost: number
  sessions: number
  messages: number
  available: boolean
  /** Human path that was scanned; used for "open folder". */
  rootPath: string
  /** Error string if the adapter failed to scan. */
  error?: string
}

/** Per working-directory rollup. */
export interface ProjectSlice {
  /** Full path, used as the identity and for "open folder". */
  path: string
  /** Trailing folder name for display. */
  label: string
  total: number
  cost: number
  sessions: number
  messages: number
  share: number // 0..1
  /** Which adapters contributed to this project. */
  adapters: AdapterId[]
}

/** Cache efficiency rollup. */
export interface CacheStats {
  readTokens: number
  writeTokens: number
  freshInputTokens: number
  /** cacheRead / (cacheRead + freshInput) — share of prompt served from cache. */
  hitRate: number
  /** What the cached tokens would have cost at the full input rate. */
  costWithoutCache: number
  /** What they actually cost. */
  costWithCache: number
  /** costWithoutCache - costWithCache. */
  saved: number
}

/** One stacked-bar entry: a day with per-model token counts. */
export interface DayModelPoint {
  day: string
  model: string
  total: number
}

export interface HeatCell {
  day: string
  total: number
  turns: number
}

export interface DashboardStats {
  totalTokens: number
  totalCost: number
  sessions: number
  messages: number
  activeDays: number
  currentStreak: number
  cacheHitRate: number
  favoriteModel: { model: string; share: number } | null
}

export interface Dashboard {
  range: RangeKey
  generatedAt: string
  stats: DashboardStats
  models: ModelSlice[]
  adapters: AdapterSlice[]
  projects: ProjectSlice[]
  cache: CacheStats
  cost: CostBreakdown
  perDay: DayModelPoint[]
  heatmap: HeatCell[]
  /** Full inclusive day span used for the heatmap grid. */
  heatStart: string
  heatEnd: string
  /** Where the price list came from, surfaced so estimates are never mistaken for bills. */
  pricing: { path: string; usingOverrides: boolean; unmatchedModels: string[] }
}

export type RangeKey = '7d' | '30d' | '90d' | 'all'

export interface ScanResult {
  ok: boolean
  dashboard?: Dashboard
  error?: string
}

export interface TkApi {
  scan: (range: RangeKey) => Promise<ScanResult>
  openPath: (p: string) => Promise<void>
  /** Creates `~/.token-atlas/pricing.json` if absent, then opens it for editing. */
  editPricing: () => Promise<void>
}

declare global {
  interface Window {
    tk: TkApi
  }
}
