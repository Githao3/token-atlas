/**
 * Providers disagree about whether `input_tokens` already contains the cached
 * portion of the prompt:
 *   - zcode / codex: mostly inclusive (input covers cache reads)
 *   - Claude Code:   exclusive (input, cache_creation and cache_read are disjoint)
 * and zcode is not even internally consistent across providers it proxies.
 *
 * `splitTokens` normalizes any of those shapes into four disjoint buckets that
 * sum exactly to `authoritativeTotal` when one is supplied. Keeping the reported
 * total authoritative means our headline number always matches what the agent
 * itself shows, while the buckets stay usable for cost and cache math.
 */
export interface TokenParts {
  freshInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  total: number
}

export function splitTokens(input: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Total as reported by the source, if it reports one. */
  reportedTotal?: number
  /** Force the interpretation when the source is known to be exclusive. */
  inputExcludesCache?: boolean
}): TokenParts {
  const inTok = clamp(input.inputTokens)
  const out = clamp(input.outputTokens)
  const cacheRead = clamp(input.cacheReadTokens)
  const cacheWrite = clamp(input.cacheWriteTokens)
  const cached = cacheRead + cacheWrite
  const reported = input.reportedTotal && input.reportedTotal > 0 ? input.reportedTotal : 0

  let inclusive: boolean
  if (input.inputExcludesCache) {
    inclusive = false
  } else if (reported > 0 && reported === inTok + out) {
    inclusive = true // total ignores cache ⇒ cache must already sit inside input
  } else if (reported > 0 && reported === inTok + out + cached) {
    inclusive = false
  } else {
    inclusive = cached > 0 && inTok >= cached
  }

  let fresh = inclusive ? clamp(inTok - cached) : inTok
  const total = reported > 0 ? reported : fresh + cacheRead + cacheWrite + out

  // Reconcile: absorb any drift into the fresh-input bucket so the four parts
  // always add up to the total we are going to display.
  const drift = total - (fresh + cacheRead + cacheWrite + out)
  if (drift !== 0) fresh = clamp(fresh + drift)

  return { freshInputTokens: fresh, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, outputTokens: out, total }
}

function clamp(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Normalize a filesystem path for use as a project key. */
export function normalizeProject(p: string | undefined): string | undefined {
  if (!p || typeof p !== 'string') return undefined
  const trimmed = p.trim().replace(/[\\/]+$/, '')
  return trimmed.length > 0 ? trimmed : undefined
}

/** Trailing folder name, for compact display. */
export function projectLabel(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * Collapse provider-qualified model ids onto the bare model name so the same
 * model reached through different gateways rolls up together, e.g.
 *   `zai-org/GLM-5.2`              -> `glm-5.2`
 *   `@cf/moonshotai/kimi-k2.7-code` -> `kimi-k2.7-code`
 * Ids without a slash (`gpt-5.5`, `claude-opus-4.8`) are returned unchanged
 * apart from lower-casing.
 */
export function normalizeModel(id: string | undefined): string {
  if (!id) return 'unknown'
  const last = id.split('/').filter(Boolean).pop() ?? id
  return last.trim().toLowerCase() || 'unknown'
}
