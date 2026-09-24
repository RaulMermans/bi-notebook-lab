import { runConformanceCase } from './runCase'
import type { DaxConformanceCase } from './types'

export interface ConformanceCategorySummary {
  category: string
  passed: number
  /** Excludes known-divergence cases — `passed`/`gradedTotal` is the fraction that matters for "is this category trustworthy." */
  gradedTotal: number
  knownDivergences: number
  failures: { id: string; description: string; reason?: string }[]
}

export interface ConformanceReport {
  categories: ConformanceCategorySummary[]
  totalCases: number
  totalPassed: number
  unexpectedFailures: number
  knownDivergences: number
}

/** Runs every case and aggregates PASS/FAIL/KNOWN DIVERGENCE per category — generated from the actual case list, never hardcoded (brief §29). */
export function summarizeConformance(cases: DaxConformanceCase[]): ConformanceReport {
  const byCategory = new Map<string, ConformanceCategorySummary>()
  let totalPassed = 0
  let unexpectedFailures = 0
  let knownDivergences = 0

  for (const testCase of cases) {
    const summary = byCategory.get(testCase.category) ?? {
      category: testCase.category,
      passed: 0,
      gradedTotal: 0,
      knownDivergences: 0,
      failures: [],
    }
    byCategory.set(testCase.category, summary)

    if (testCase.knownDivergence) {
      knownDivergences += 1
      summary.knownDivergences += 1
      continue
    }

    summary.gradedTotal += 1
    const result = runConformanceCase(testCase)
    if (result.matches) {
      totalPassed += 1
      summary.passed += 1
    } else {
      unexpectedFailures += 1
      summary.failures.push({ id: testCase.id, description: testCase.description, reason: result.reason ?? result.diagnostics.join('; ') })
    }
  }

  return { categories: [...byCategory.values()], totalCases: cases.length, totalPassed, unexpectedFailures, knownDivergences }
}

export function formatConformanceReport(report: ConformanceReport): string {
  const lines = ['DAX Semantic Conformance', '']
  const nameWidth = Math.max(...report.categories.map((c) => c.category.length), 20)
  for (const category of report.categories) {
    const fraction = `${category.passed}/${category.gradedTotal}`
    lines.push(`${category.category.padEnd(nameWidth)} ${fraction}`)
  }
  lines.push('')
  lines.push(`${'Unexpected failures'.padEnd(nameWidth)} ${report.unexpectedFailures}`)
  lines.push(`${'Known divergences'.padEnd(nameWidth)} ${report.knownDivergences}`)
  return lines.join('\n')
}
