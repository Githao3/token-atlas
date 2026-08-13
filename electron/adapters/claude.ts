import type { UsageRecord } from '@shared/types'
import { exists, home, readJsonl, walkFiles } from '../scan/util'
import { normalizeModel, normalizeProject, splitTokens } from '../scan/normalize'
import type { AdapterOutput } from './zcode'

const ROOT = home('.claude', 'projects')

/**
 * Claude Code writes one JSONL per session under
 * `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. Assistant messages
 * carry `message.usage` with input / output / cache token counts and the model
 * id. Here `input_tokens` is EXCLUSIVE of cache: cache_creation and cache_read
 * are separate buckets, so the true prompt size is their sum.
 */
export async function scanClaude(): Promise<AdapterOutput> {
  const base: AdapterOutput = {
    adapter: 'claude',
    label: 'Claude Code',
    rootPath: ROOT,
    available: false,
    records: [],
    source: 'jsonl:projects'
  }
  if (!(await exists(ROOT))) return base

  try {
    const files = await walkFiles(ROOT, (n) => n.endsWith('.jsonl'))
    const records: UsageRecord[] = []
    const sessions = new Set<string>()
    for (const f of files) {
      await readJsonl(f, ['"usage"'], (obj) => {
        const o = obj as ClaudeLine
        const msg = o?.message
        const usage = msg?.usage
        if (!usage || o.type !== 'assistant') return
        const parts = splitTokens({
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          inputExcludesCache: true
        })
        if (parts.total <= 0) return
        const sid = o.sessionId ?? o.session_id
        if (sid) sessions.add(sid)
        records.push({
          adapter: 'claude',
          ts: o.timestamp ?? new Date().toISOString(),
          model: normalizeModel(msg.model),
          ...parts,
          reasoningTokens: 0,
          cost: 0,
          sessionId: sid,
          project: normalizeProject(o.cwd)
        })
      })
    }
    return {
      ...base,
      available: records.length > 0,
      records,
      sessionHint: sessions.size || undefined
    }
  } catch (e) {
    return { ...base, error: (e as Error).message }
  }
}

interface ClaudeLine {
  type?: string
  timestamp?: string
  sessionId?: string
  session_id?: string
  cwd?: string
  message?: {
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}
