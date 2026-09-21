import type { ModelTable, SemanticModel } from '../../domain/model'

/**
 * A pure leaf module (depends only on `domain/model`) so it can be imported
 * by both `relationshipHelpers.ts` and `modelRuntime.ts` without creating a
 * circular import between them — `graphAnalysis.ts` re-exports this for
 * every existing `modelTableFor` import site.
 */
export function modelTableFor(model: SemanticModel, ref: { datasetId: string; tableId: string }): ModelTable | undefined {
  return model.tables.find((t) => t.datasetId === ref.datasetId && t.tableId === ref.tableId)
}
