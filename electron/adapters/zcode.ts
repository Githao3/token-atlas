import type { AdapterId, UsageRecord } from '@shared/types'
import { exists, home, readJsonl, snapshotSqlite, walkFiles } from '../scan/util'
import { queryAll } from '../scan/sqlite'
import { normalizeModel, normalizeProject, splitTokens } from '../scan/normalize'

export interface AdapterOutput {
  adapter: AdapterId
  label: string
  rootPath: string
  available: boolean
  records: UsageRecord[]
  /** Session count reported by the source itself when it is more accurate. */
  sessionHint?: number
  error?: string
  /** Which mechanism produced the data, surfaced in the UI for transparency. */
  source: string
}

const ROOT = home('.zcode', 'cli')
const DB = home('.zcode', 'cli', 'db', 'db.sqlite')
const ROLLOUT = home('.zcode', 'cli', 'rollout')
const AGENTS = home('.zcode', 'cli', 'agents')

const USAGE_SQL = `SELECT m.session_id, m.model_id, m.agent, m.query_source, m.started_at,
        m.input_tokens, m.output_tokens, m.reasoning_tokens,
        m.cache_creation_input_tokens, m.cache_read_input_tokens,
        m.provider_total_tokens, m.computed_total_tokens,
        s.directory AS project_dir, s.path AS project_path
 FROM model_usage m
 LEFT JOIN session s ON s.id = m.session_id
 WHERE m.started_at IS NOT NULL`

/**
 * zcode keeps a first-class usage ledger in SQLite (`model_usage`), which is far
 * more complete than the on-disk transcripts: every model request is recorded
 * with per-kind token counts.
 *
 * We open the live database **read-only**. SQLite's WAL mode allows any number
 * of concurrent readers alongside the writer, so this neither blocks nor mutates
 * a running zcode. Copying the file first (the previous approach) was strictly
 * worse: `copyFile` takes a share-mode lock that Windows rejects with `EBUSY`
 * whenever zcode is active, which silently pushed every scan onto the much
 * poorer JSONL fallback.
 */
export async function scanZcode(): Promise<AdapterOutput> {
  const base: AdapterOutput = {
    adapter: 'zcode',
    label: 'ZCode',
    rootPath: ROOT,
    available: false,
    records: [],
    source: 'none'
  }
  if (!(await exists(ROOT))) return base

  if (await exists(DB)) {
    const attempts: Array<{ label: string; open: () => Promise<string> }> = [
      { label: 'sqlite:model_usage', open: async () => DB },
      { label: 'sqlite:model_usage(snapshot)', open: () => snapshotSqlite(DB, 'zcode') }
    ]
    const errors: string[] = []
    for (const attempt of attempts) {
      try {
        const path = await attempt.open()
        const rows = await queryAll(path, USAGE_SQL)
        if (!rows) {
          errors.push('node:sqlite 不可用')
          break // no driver — retrying with a copy will not help
        }
        const records = rowsToRecords(rows)
        const sessions = await queryAll(path, 'SELECT COUNT(*) AS n FROM session')
        return {
          ...base,
          available: true,
          records,
          sessionHint: sessions ? num(sessions[0]?.n) : undefined,
          source: attempt.label
        }
      } catch (e) {
        errors.push(`${attempt.label}: ${(e as Error).message}`)
      }
    }
    if (errors.length > 0) base.error = `SQLite 读取失败，已回退到 JSONL（${errors.join('；')}）`
  }

  return scanZcodeJsonl(base)
}

function rowsToRecords(rows: Array<Record<string, unknown>>): UsageRecord[] {
  const records: UsageRecord[] = []
  for (const r of rows) {
    const startedAt = Number(r.started_at)
    if (!Number.isFinite(startedAt) || startedAt <= 0) continue
    const parts = splitTokens({
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cacheReadTokens: num(r.cache_read_input_tokens),
      cacheWriteTokens: num(r.cache_creation_input_tokens),
      reportedTotal: num(r.computed_total_tokens) || num(r.provider_total_tokens)
    })
    if (parts.total <= 0) continue
    records.push({
      adapter: 'zcode',
      ts: new Date(startedAt).toISOString(),
      model: normalizeModel(str(r.model_id)),
      ...parts,
      reasoningTokens: num(r.reasoning_tokens),
      cost: 0,
      sessionId: str(r.session_id),
      project: normalizeProject(str(r.project_dir) ?? str(r.project_path))
    })
  }
  return records
}

/**
 * JSONL fallback used only when SQLite is genuinely unavailable. Two on-disk
 * shapes carry usage, and they differ:
 *   - rollout `model-io-*.jsonl`: flat records with `response.usage` and a
 *     top-level `model.modelId` / `startedAt` / `completedAt`.
 *   - agent `transcript.jsonl`: `model_network_status` lines whose `payload`
 *     holds `usage`, `model.modelId` and `timestamp`.
 * This coverage is partial (only sessions that still have transcripts), so it is
 * strictly a degraded mode; the numbers here will be lower than the SQLite path.
 */
async function scanZcodeJsonl(base: AdapterOutput): Promise<AdapterOutput> {
  try {
    const files: string[] = []
    if (await exists(ROLLOUT)) {
      files.push(...(await walkFiles(ROLLOUT, (n) => n.endsWith('.jsonl'))))
    }
    if (await exists(AGENTS)) {
      files.push(...(await walkFiles(AGENTS, (n) => n === 'transcript.jsonl')))
    }
    const records: UsageRecord[] = []
    const seen = new Set<string>()
    const sessions = new Set<string>()
    for (const f of files) {
      await readJsonl(f, ['"inputTokens"'], (obj) => {
        const o = obj as ZcodeLine
        // Normalize both shapes into one view.
        const flatUsage = o.response?.usage
        const nestedUsage = o.payload?.usage
        const usage = flatUsage ?? nestedUsage
        if (!usage || typeof usage.inputTokens !== 'number') return

        const requestId = o.requestId ?? o.payload?.requestId ?? o.id
        if (requestId) {
          if (seen.has(requestId)) return
          seen.add(requestId)
        }
        const model = normalizeModel(
          o.response?.modelId ?? o.model?.modelId ?? o.payload?.model?.modelId
        )
        const ts = o.completedAt ?? o.startedAt ?? o.payload?.timestamp ?? o.timestamp
        const sid = o.sessionId ?? o.payload?.parentSessionId
        const parts = splitTokens({
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheWriteTokens: 0,
          reportedTotal: usage.totalTokens
        })
        if (parts.total <= 0) return
        if (sid) sessions.add(sid)
        records.push({
          adapter: 'zcode',
          ts: ts ?? new Date().toISOString(),
          model,
          ...parts,
          reasoningTokens: usage.reasoningTokens ?? 0,
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
      sessionHint: sessions.size || undefined,
      source: 'jsonl:rollout+transcript'
    }
  } catch (e) {
    return { ...base, error: (base.error ?? '') + (e as Error).message }
  }
}

interface ZcodeLine {
  // transcript shape
  id?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  // rollout (flat) shape
  requestId?: string
  startedAt?: string
  completedAt?: string
  model?: { modelId?: string }
  response?: { modelId?: string; usage?: ZcodeUsage }
  payload?: {
    timestamp?: string
    requestId?: string
    parentSessionId?: string
    model?: { modelId?: string }
    usage?: ZcodeUsage
  }
}

interface ZcodeUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  reasoningTokens?: number
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
