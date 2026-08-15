/** Model accent colors, cycled by index; used by charts, legends and swatches. */
export const MODEL_COLORS = [
  '#5b8cff',
  '#22c39a',
  '#b07cff',
  '#ff5d6c',
  '#f5a524',
  '#16c0d8',
  '#f78ac0',
  '#8de24f',
  '#9aa7ff',
  '#ffd166'
]

export function colorForIndex(i: number): string {
  return MODEL_COLORS[i % MODEL_COLORS.length]!
}

/** Compact token formatter: 422500000 -> "422.5M". */
export function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(Math.round(n))
}

/** Split "422.5M" into value + unit for large typographic display. */
export function splitValue(n: number): { v: string; unit: string } {
  if (n >= 1e9) return { v: (n / 1e9).toFixed(2), unit: 'B' }
  if (n >= 1e6) return { v: (n / 1e6).toFixed(1), unit: 'M' }
  if (n >= 1e3) return { v: (n / 1e3).toFixed(1), unit: 'K' }
  return { v: String(Math.round(n)), unit: '' }
}

/** USD formatter that keeps small amounts legible: $0.42, $12.3, $1.2K. */
export function money(n: number): string {
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K'
  if (n >= 100) return '$' + n.toFixed(0)
  if (n >= 1) return '$' + n.toFixed(2)
  if (n > 0) return '$' + n.toFixed(2)
  return '$0'
}

/** Split a dollar amount for large display: { v: "235", unit: "" } / { v: "1.2", unit: "K" }. */
export function splitMoney(n: number): { v: string; unit: string } {
  if (n >= 1000) return { v: (n / 1000).toFixed(1), unit: 'K' }
  if (n >= 100) return { v: n.toFixed(0), unit: '' }
  return { v: n.toFixed(2), unit: '' }
}

/** Read a resolved CSS custom property from :root (theme aware). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * Sort descending by `value` and keep the leading `n`, reporting the tail as a
 * single bucket. A 24-model list buries the five that matter under a long tail
 * of sub-1% rows, and the donut turns those into slivers too thin to read.
 */
export function topWithOthers<T>(
  items: T[],
  value: (t: T) => number,
  n: number
): { top: T[]; othersValue: number; othersCount: number; grand: number } {
  const sorted = [...items].sort((a, b) => value(b) - value(a))
  const rest = sorted.slice(n)
  const othersValue = rest.reduce((s, x) => s + value(x), 0)
  return {
    top: sorted.slice(0, n),
    othersValue,
    othersCount: rest.length,
    grand: sorted.reduce((s, x) => s + value(x), 0)
  }
}
