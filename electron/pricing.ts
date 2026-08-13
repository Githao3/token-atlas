import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { home } from './scan/util'

/**
 * Price list, in USD per 1,000,000 tokens.
 *
 * IMPORTANT: these are *estimates* used to give the numbers a sense of scale.
 * Provider pricing changes often and varies by tier/region, so treat every
 * figure in the UI as an approximation. Drop a JSON file at
 * `~/.token-atlas/pricing.json` to override any of it — see `PRICING_FILE`.
 */
export interface Rate {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface PricingRule {
  /** Case-insensitive substring matched against the model id. */
  match: string
  rate: Rate
}

export const PRICING_FILE = home('.token-atlas', 'pricing.json')

/** Matched top-to-bottom, so put more specific patterns first. */
const DEFAULT_RULES: PricingRule[] = [
  // free tiers first — otherwise the generic family rule would win
  { match: '-free', rate: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },

  { match: 'claude-opus', rate: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { match: 'claude-sonnet', rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: 'claude-haiku', rate: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } },
  // catch-all for any other Claude variant, priced at the mid tier
  { match: 'claude', rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },

  { match: 'gpt-5', rate: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.56 } },
  { match: 'gpt-', rate: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.56 } },

  { match: 'gemini', rate: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.6 } },
  { match: 'grok', rate: { input: 3, output: 15, cacheRead: 0.75, cacheWrite: 3.75 } },

  { match: 'deepseek-v4-pro', rate: { input: 0.55, output: 2.19, cacheRead: 0.07, cacheWrite: 0.7 } },
  { match: 'deepseek', rate: { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite: 0.35 } },

  { match: 'glm', rate: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.75 } },
  { match: 'kimi', rate: { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0.75 } },
  { match: 'mimo', rate: { input: 0.3, output: 1.2, cacheRead: 0.05, cacheWrite: 0.4 } },
  { match: 'qwen', rate: { input: 0.4, output: 1.2, cacheRead: 0.08, cacheWrite: 0.5 } },
  { match: 'doubao', rate: { input: 0.15, output: 0.6, cacheRead: 0.03, cacheWrite: 0.2 } },
  { match: 'minimax', rate: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.4 } }
]

const FALLBACK: Rate = { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1.25 }

export interface PricingTable {
  rateFor(model: string): { rate: Rate; matched: boolean }
  usingOverrides: boolean
  path: string
}

interface OverrideFile {
  /** Extra rules, matched *before* the built-ins so they win. */
  rules?: PricingRule[]
  /** Set true to ignore the built-in rules entirely. */
  replaceRules?: boolean
  /** Patch individual models by exact id (highest priority). */
  models?: Record<string, Partial<Rate>>
  fallback?: Partial<Rate>
}

/**
 * Load the price list, merging user overrides when present. Never throws: a
 * malformed override file degrades to the built-in defaults.
 *
 * User `rules` are *prepended* rather than replacing the built-ins, so a file
 * generated once by "edit pricing" does not freeze the table and silently miss
 * models added to the defaults later. Pass `replaceRules: true` to opt out.
 */
export async function loadPricing(): Promise<PricingTable> {
  let rules = DEFAULT_RULES
  let fallback = FALLBACK
  const exact: Record<string, Rate> = {}
  let usingOverrides = false

  try {
    const raw = await fs.readFile(PRICING_FILE, 'utf8')
    const parsed = JSON.parse(raw) as OverrideFile
    if (Array.isArray(parsed.rules) && parsed.rules.length > 0) {
      const valid = parsed.rules.filter((r) => r && typeof r.match === 'string' && r.rate)
      rules = parsed.replaceRules ? valid : [...valid, ...DEFAULT_RULES]
      // A file that merely mirrors the defaults is not a real override.
      usingOverrides = parsed.replaceRules === true || !sameAsDefaults(valid)
    }
    if (parsed.models) {
      for (const [model, patch] of Object.entries(parsed.models)) {
        exact[model.toLowerCase()] = { ...FALLBACK, ...patch }
      }
      usingOverrides = true
    }
    if (parsed.fallback) {
      fallback = { ...FALLBACK, ...parsed.fallback }
      usingOverrides = true
    }
  } catch {
    /* no override file, or it is unreadable — defaults are fine */
  }

  const cache = new Map<string, { rate: Rate; matched: boolean }>()
  return {
    usingOverrides,
    path: PRICING_FILE,
    rateFor(model: string) {
      const key = model.toLowerCase()
      const hit = cache.get(key)
      if (hit) return hit
      let result = { rate: fallback, matched: false }
      const direct = exact[key]
      if (direct) {
        result = { rate: direct, matched: true }
      } else {
        for (const r of rules) {
          if (key.includes(r.match.toLowerCase())) {
            result = { rate: r.rate, matched: true }
            break
          }
        }
      }
      cache.set(key, result)
      return result
    }
  }
}

/** True when the supplied rules are byte-identical to the shipped defaults. */
function sameAsDefaults(rules: PricingRule[]): boolean {
  return JSON.stringify(rules) === JSON.stringify(DEFAULT_RULES)
}

/** Write the built-in table to disk so users have something to edit. */
export async function writeDefaultPricingFile(): Promise<string> {
  const dir = join(PRICING_FILE, '..')
  await fs.mkdir(dir, { recursive: true })
  const body = {
    _comment:
      'USD per 1,000,000 tokens. Estimates only — edit to match your actual provider invoice. Patterns match as case-insensitive substrings, top to bottom. Rules listed here are checked BEFORE the built-in table, so you only need to list what you want to change. Set "replaceRules": true to ignore the built-ins entirely. Use "models" for exact model ids and "fallback" for anything unmatched.',
    rules: DEFAULT_RULES,
    fallback: FALLBACK
  }
  await fs.writeFile(PRICING_FILE, JSON.stringify(body, null, 2), 'utf8')
  return PRICING_FILE
}

/** Cost in USD for one record's token split. */
export function costOf(
  rate: Rate,
  parts: { freshInputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number }
): number {
  const M = 1_000_000
  return (
    (parts.freshInputTokens * rate.input) / M +
    (parts.cacheReadTokens * rate.cacheRead) / M +
    (parts.cacheWriteTokens * rate.cacheWrite) / M +
    (parts.outputTokens * rate.output) / M
  )
}
