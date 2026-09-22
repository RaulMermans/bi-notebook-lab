import { ExpressionEvalError } from './evalError'

export interface CustomColumnFunction {
  minArgs: number
  maxArgs: number
  apply(args: unknown[]): unknown
}

function asText(value: unknown, functionName: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  throw new ExpressionEvalError('QUERY_CUSTOM_TYPE_ERROR', `${functionName} requires a text argument.`)
}

function asNumber(value: unknown, functionName: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new ExpressionEvalError('QUERY_CUSTOM_TYPE_ERROR', `${functionName} requires a numeric argument.`)
}

function asDate(value: unknown, functionName: string): Date {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  throw new ExpressionEvalError('QUERY_CUSTOM_TYPE_ERROR', `${functionName} requires a date argument.`)
}

/** The first, deliberately small Custom Column function set — see docs/POWER_QUERY_EXPRESSIONS.md for the full supported-syntax boundary. Not a general M library. */
export const CUSTOM_COLUMN_FUNCTIONS: Record<string, CustomColumnFunction> = {
  'Text.Trim': { minArgs: 1, maxArgs: 1, apply: ([a]) => asText(a, 'Text.Trim').trim() },
  'Text.Upper': { minArgs: 1, maxArgs: 1, apply: ([a]) => asText(a, 'Text.Upper').toUpperCase() },
  'Text.Lower': { minArgs: 1, maxArgs: 1, apply: ([a]) => asText(a, 'Text.Lower').toLowerCase() },
  'Text.Length': { minArgs: 1, maxArgs: 1, apply: ([a]) => asText(a, 'Text.Length').length },
  'Number.Abs': { minArgs: 1, maxArgs: 1, apply: ([a]) => Math.abs(asNumber(a, 'Number.Abs')) },
  'Number.Round': {
    minArgs: 1,
    maxArgs: 2,
    apply: ([a, digitsArg]) => {
      const value = asNumber(a, 'Number.Round')
      const digits = digitsArg === undefined ? 0 : asNumber(digitsArg, 'Number.Round')
      const factor = 10 ** digits
      return Math.round(value * factor) / factor
    },
  },
  'Date.Year': { minArgs: 1, maxArgs: 1, apply: ([a]) => asDate(a, 'Date.Year').getUTCFullYear() },
  'Date.Month': { minArgs: 1, maxArgs: 1, apply: ([a]) => asDate(a, 'Date.Month').getUTCMonth() + 1 },
  'Date.Day': { minArgs: 1, maxArgs: 1, apply: ([a]) => asDate(a, 'Date.Day').getUTCDate() },
}
