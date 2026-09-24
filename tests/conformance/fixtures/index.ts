import type { DaxConformanceCase } from '../../../src/conformance/types'
import { SCALAR_CASES } from './scalar'
import { BLANK_CASES } from './blanks'
import { VARIABLE_CASES } from './variables'
import { AGGREGATION_CASES } from './aggregations'
import { FILTER_CONTEXT_CASES } from './filterContext'
import { CALCULATE_CASES } from './calculate'
import { ITERATOR_CASES } from './iterators'
import { RELATIONSHIP_CASES } from './relationships'
import { TIME_INTELLIGENCE_CASES } from './timeIntelligence'
import { ADVANCED_RELATIONSHIP_CASES } from './advancedRelationships'

export const ALL_CONFORMANCE_CASES: DaxConformanceCase[] = [
  ...SCALAR_CASES,
  ...BLANK_CASES,
  ...VARIABLE_CASES,
  ...AGGREGATION_CASES,
  ...FILTER_CONTEXT_CASES,
  ...CALCULATE_CASES,
  ...ITERATOR_CASES,
  ...RELATIONSHIP_CASES,
  ...TIME_INTELLIGENCE_CASES,
  ...ADVANCED_RELATIONSHIP_CASES,
]
