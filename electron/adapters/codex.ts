import type { UsageRecord } from '@shared/types'
import { exists, home, readJsonl, walkFiles } from '../scan/util'
import { normalizeModel, normalizeProject, splitTokens } from '../scan/normalize'
import type { AdapterOutput } from './zcode'

const ROOT = home('.codex', 'sessions')

/**
 * Codex writes one JSONL per session under `~/.codex/sessions/YYYY/MM/DD/*.jsonl`.
 * Each line has a top-level `type`; the token snapshots we want are
 * `event_msg` payloads with inner `type: 'token_count'`. The active model comes
 * from earlier `turn_context` lines in the same file.
 *
 * `total_token_usage` is cumulative over the session; `last_token_usage` is the
 * usage of the most recent request BUT codex emits the same `token_count` event
 * multiple times per turn (once as it streams, once at completion), so summing
 * `last_token_usage` overcounts. We therefore derive per-event increments by
 * diffing `total_token_usage` against the previous event in the same file and
 * attribute the delta to the model currently in scope.
 */
export async function scanCodex(): Promise<AdapterOutput> {
  const base: AdapterOutput = {
    adapter: 'codex',
    label: 'Codex',
    rootPath: ROOT,
    available: false,
    records: [],
    source: 'jsonl:sessions'
  }
  if (!(await exists(ROOT))) return base

  try {
    const files = await walkFiles(ROOT, (n) => n.endsWith('.jsonl'))
    const records: UsageRecord[] = []
    let sessions = 0
    for (const f of files) {
      sessions++
      let currentModel = 'unknown'
      // Older rollouts omit `session_meta.payload.session_id`; the uuid is still
      // in the filename, so fall back to that rather than losing the grouping.
      let sessionId: string | undefined = sessionIdFromFilename(f)
      let cwd: string | undefined
      const prev = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 }
      await readJsonl(f, ['token_count', 'turn_context', 'session_meta'], (obj) => {
        const o = obj as CodexLine
        if (o?.type === 'session_meta' && o.payload) {
          sessionId = o.payload.session_id ?? o.payload.id ?? sessionId
          cwd = o.payload.cwd ?? cwd
          return
        }
        if (o?.type === 'turn_context' && o.payload) {
          if (o.payload.model) currentModel = normalizeModel(o.payload.model)
          if (o.payload.cwd) cwd = o.payload.cwd
          return
        }
        if (o?.type === 'event_msg' && o.payload?.type === 'token_count') {
          const running = o.payload.info?.total_token_usage
          if (!running) return
          const rInput = running.input_tokens ?? 0
          const rCached = running.cached_input_tokens ?? 0
          const rOutput = running.output_tokens ?? 0
          const rReason = running.reasoning_output_tokens ?? 0
          const rTotal = running.total_tokens ?? rInput + rOutput
          // Increment since the previous snapshot. Guard against non-monotonic
          // updates (rare, but possible if codex ever restarts the counter).
          const dInput = Math.max(0, rInput - prev.input)
          const dCached = Math.max(0, rCached - prev.cached)
          const dOutput = Math.max(0, rOutput - prev.output)
          const dReason = Math.max(0, rReason - prev.reasoning)
          const dTotal = Math.max(0, rTotal - prev.total)
          prev.input = rInput
          prev.cached = rCached
          prev.output = rOutput
          prev.reasoning = rReason
          prev.total = rTotal
          if (dTotal <= 0) return
          const parts = splitTokens({
            inputTokens: dInput,
            outputTokens: dOutput,
            cacheReadTokens: dCached,
            cacheWriteTokens: 0,
            reportedTotal: dTotal
          })
          records.push({
            adapter: 'codex',
            ts: o.timestamp ?? new Date().toISOString(),
            model: currentModel,
            ...parts,
            reasoningTokens: dReason,
            cost: 0,
            sessionId,
            project: normalizeProject(cwd)
          })
        }
      })
    }
    return {
      ...base,
      available: records.length > 0,
      records,
      sessionHint: sessions
    }
  } catch (e) {
    return { ...base, error: (e as Error).message }
  }
}

/** Extract the trailing UUID from `rollout-<ts>-<uuid>.jsonl`. */
function sessionIdFromFilename(path: string): string | undefined {
  const name = path.split(/[\\/]/).pop() ?? ''
  const m = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return m ? m[1] : undefined
}

interface CodexLine {
  type?: string
  timestamp?: string
  payload?: {
    type?: string
    session_id?: string
    id?: string
    cwd?: string
    model?: string
    info?: {
      total_token_usage?: {
        input_tokens?: number
        cached_input_tokens?: number
        output_tokens?: number
        reasoning_output_tokens?: number
        total_tokens?: number
      }
    }
  }
}
