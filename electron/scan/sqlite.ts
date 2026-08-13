/**
 * Thin wrapper around Node's built-in `node:sqlite`. It is loaded lazily and
 * defensively: if the runtime does not expose the module (older Electron / Node
 * without the experimental flag) the adapter that needs it degrades to its
 * JSONL fallback instead of crashing the whole scan.
 */

type Row = Record<string, unknown>

interface DatabaseSyncLike {
  prepare(sql: string): { all(...params: unknown[]): Row[] }
  close(): void
}

type DatabaseSyncCtor = new (path: string, opts?: { readOnly?: boolean }) => DatabaseSyncLike

let ctor: DatabaseSyncCtor | null | undefined

async function loadCtor(): Promise<DatabaseSyncCtor | null> {
  if (ctor !== undefined) return ctor
  try {
    const mod = (await import('node:sqlite')) as unknown as { DatabaseSync?: DatabaseSyncCtor }
    ctor = mod.DatabaseSync ?? null
  } catch {
    ctor = null
  }
  return ctor
}

export async function sqliteAvailable(): Promise<boolean> {
  return (await loadCtor()) !== null
}

/**
 * Run a read-only query against a SQLite file. Returns `null` when SQLite is
 * unavailable so callers can distinguish "no driver" from "no rows".
 */
export async function queryAll(file: string, sql: string, params: unknown[] = []): Promise<Row[] | null> {
  const C = await loadCtor()
  if (!C) return null
  let db: DatabaseSyncLike | null = null
  try {
    db = new C(file, { readOnly: true })
    return db.prepare(sql).all(...params)
  } finally {
    try {
      db?.close()
    } catch {
      /* already closed */
    }
  }
}
