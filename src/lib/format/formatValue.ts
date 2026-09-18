/**
 * Generic scalar formatter shared by the Context Explorer and (eventually)
 * anything else that needs to show a measure/column result without assuming
 * a currency or other domain-specific format. There is no formatting
 * metadata on `Measure`/`CalculatedColumn` yet (docs/MEASURES.md), so this is
 * deliberately a plain number formatter — never a guessed currency symbol
 * (Sprint 6 brief §11 "Generic Value Comparison").
 */
export function formatContextValue(value: unknown): string {
  if (value === null || value === undefined) return 'Blank'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return String(value)
}

/** Formats a delta with an explicit sign so "+0" and "-0" both read unambiguously. */
export function formatSignedNumber(value: number): string {
  const formatted = Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (value > 0) return `+${formatted}`
  if (value < 0) return `-${formatted}`
  return formatted
}

/** Formats a fractional delta (e.g. `-0.944`) as a percentage string (`-94.4%`). */
export function formatPercent(value: number): string {
  const percent = value * 100
  const rounded = Math.round(percent * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}
