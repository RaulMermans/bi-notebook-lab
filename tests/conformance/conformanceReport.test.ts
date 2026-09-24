import { describe, expect, it } from 'vitest'
import { formatConformanceReport, summarizeConformance } from '../../src/conformance/report'
import { ALL_CONFORMANCE_CASES } from './fixtures'

describe('conformance report', () => {
  it('generates a summary consistent with the actual case list and prints it', () => {
    const report = summarizeConformance(ALL_CONFORMANCE_CASES)

    expect(report.totalCases).toBe(ALL_CONFORMANCE_CASES.length)
    expect(report.totalPassed + report.unexpectedFailures + report.knownDivergences).toBe(report.totalCases)
    expect(report.categories.reduce((sum, c) => sum + c.gradedTotal + c.knownDivergences, 0)).toBe(report.totalCases)

    // eslint-disable-next-line no-console
    console.log(formatConformanceReport(report))

    if (report.unexpectedFailures > 0) {
      const details = report.categories
        .flatMap((c) => c.failures)
        .map((f) => `  ${f.id}: ${f.description} — ${f.reason}`)
        .join('\n')
      throw new Error(`${report.unexpectedFailures} unexpected conformance failure(s):\n${details}`)
    }
  })

  it('has at least 60 cases across the required families', () => {
    expect(ALL_CONFORMANCE_CASES.length).toBeGreaterThanOrEqual(60)
  })

  it('never claims power-bi-verified provenance in this pass', () => {
    const claimed = ALL_CONFORMANCE_CASES.filter((c) => c.provenance === 'power-bi-verified')
    expect(claimed).toEqual([])
  })
})
