import type { UsageRecord } from '@shared/types'
import { exists, home, snapshotSqlite } from '../scan/util'
import { queryAll } from '../scan/sqlite'
import { normalizeModel, normalizeProject, splitTokens } from '../scan/normalize'
import type { AdapterOutput } from './zcode'

const ROOT = home('.local', 'share', 'opencode')
const DB = home('.local', 'share', 'opencode', 'opencode.db')

/**
 * opencode (sst/opencode) keeps everything in one SQLite database. Assistant
 * messages live in the `message` table with a JSON `data` blob holding
 * `tokens.{input,output,reasoning,cache.{read,write}}`, `modelID`, `providerID`
 * and a `path.cwd`. Session-level rollups also exist in `session`
 * (tokens_input/output/cache_*), but the per-message rows give us the model,
 * project and timestamp we need for the time series.
 *
 * As with zcode we read the live DB read-only (WAL allows concurrent readers)
 * and only fall back to a temp-file snapshot if that fails.
 */
export async function scanOpencode(): Promise<AdapterOutput> {
  const base: AdapterOutput = {
    adapter: 'opencode',
    label: 'opencode',
    rootPath: ROOT,
    available: false,
    records: [],
    source: 'none'
  }
  if (!(await exists(DB))) return base

  const SQL = `SELECT m.session_id, m.time_created, m.data AS mdata,
                      s.directory AS s_dir, s.path AS s_path
               FROM message m
               LEFT JOIN session s ON s.id = m.session_id`

  const attempts: Array<{ label: string; open: () => Promise<string> }> = [
    { label: 'sqlite:message', open: async () => DB },
    { label: 'sqlite:message(snapshot)', open: () => snapshotSqlite(DB, 'opencode') }
  ]
  const errors: string[] = []
  for (const attempt of attempts) {
    try {
      const path = await attempt.open()
      const rows = await queryAll(path, SQL)
      if (!rows) {
        errors.push('node:sqlite 不可用')
        break
      }
      const records: UsageRecord[] = []
      const sessions = new Set<string>()
      for (const r of rows) {
        const rec = toRecord(r)
        if (!rec) continue
        records.push(rec)
        if (rec.sessionId) sessions.add(rec.sessionId)
      }
      return {
        ...base,
        available: records.length > 0,
        records,
        sessionHint: sessions.size || undefined,
        source: attempt.label
      }
    } catch (e) {
      errors.push(`${attempt.label}: ${(e as Error).message}`)
    }
  }
  return { ...base, error: errors.join('；') }
}

interface OpencodeMessage {
  role?: string
  modelID?: string
  providerID?: string
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    total?: number
    cache?: { read?: number; write?: number }
  }
  time?: { created?: number; completed?: number }
  path?: { cwd?: string; root?: string }
}

function toRecord(r: Record<string, unknown>): UsageRecord | null {
  let msg: OpencodeMessage
  try {
    msg = JSON.parse(String(r.mdata)) as OpencodeMessage
  } catch {
    return null
  }
  if (msg.role !== 'assistant' || !msg.tokens) return null

  const t = msg.tokens
  const parts = splitTokens({
    inputTokens: t.input ?? 0,
    outputTokens: t.output ?? 0,
    cacheReadTokens: t.cache?.read ?? 0,
    cacheWriteTokens: t.cache?.write ?? 0,
    reportedTotal: t.total
  })
  if (parts.total <= 0) return null

  const created = Number(msg.time?.created ?? r.time_created)
  if (!Number.isFinite(created) || created <= 0) return null

  const cwd = msg.path?.cwd
  return {
    adapter: 'opencode',
    ts: new Date(created).toISOString(),
    model: normalizeModel(msg.modelID),
    ...parts,
    reasoningTokens: t.reasoning ?? 0,
    cost: 0,
    sessionId: str(r.session_id),
    project: normalizeProject(cwd ?? str(r.s_dir) ?? str(r.s_path))
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
