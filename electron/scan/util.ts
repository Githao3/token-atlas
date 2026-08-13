import { createReadStream, promises as fs } from 'node:fs'
import { createInterface } from 'node:readline'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'

/** Expand a leading `~` to the user home directory. */
export function home(...parts: string[]): string {
  return join(homedir(), ...parts)
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Recursively collect files under `dir` whose name passes `accept`.
 * Silently skips directories we cannot read (permissions, junctions, races).
 */
export async function walkFiles(
  dir: string,
  accept: (name: string, full: string) => boolean,
  depthLimit = 12
): Promise<string[]> {
  const out: string[] = []
  async function rec(current: string, depth: number): Promise<void> {
    if (depth > depthLimit) return
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = current + sep + e.name
      if (e.isDirectory()) {
        await rec(full, depth + 1)
      } else if (e.isFile() && accept(e.name, full)) {
        out.push(full)
      }
    }
  }
  await rec(dir, 0)
  return out
}

/**
 * Stream a JSONL file line by line. `marker` is a cheap substring pre-filter:
 * lines that do not contain it never reach JSON.parse, which matters a lot when
 * transcripts run into hundreds of megabytes.
 */
export async function readJsonl(
  file: string,
  markers: string[],
  onRecord: (obj: unknown) => void
): Promise<void> {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (line.length < 2) continue
      let hit = markers.length === 0
      for (const m of markers) {
        if (line.includes(m)) {
          hit = true
          break
        }
      }
      if (!hit) continue
      try {
        onRecord(JSON.parse(line))
      } catch {
        /* truncated / partially-written line — skip */
      }
    }
  } finally {
    rl.close()
    stream.close()
  }
}

/**
 * Copy a live SQLite database (plus -wal/-shm siblings) into a temp folder.
 * This is only a *fallback* — prefer opening the original read-only, which WAL
 * mode supports concurrently. `copyFile` can lose a race with an active writer
 * on Windows (`EBUSY`), so retry a few times before giving up.
 * Returns the temp path of the copied main database file.
 */
export async function snapshotSqlite(dbPath: string, tag: string): Promise<string> {
  const dir = join(tmpdir(), 'token-atlas-snap')
  await fs.mkdir(dir, { recursive: true })
  const target = join(dir, `${tag}.sqlite`)

  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fs.copyFile(dbPath, target)
      lastError = undefined
      break
    } catch (e) {
      lastError = e
      await new Promise((r) => setTimeout(r, 120 * (attempt + 1)))
    }
  }
  if (lastError) throw lastError

  for (const ext of ['-wal', '-shm']) {
    if (await exists(dbPath + ext)) {
      try {
        await fs.copyFile(dbPath + ext, target + ext)
      } catch {
        /* sibling vanished or is locked mid-copy; the main file is still readable */
      }
    }
  }
  return target
}

/** Local-time day key, e.g. 2026-08-12. */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
