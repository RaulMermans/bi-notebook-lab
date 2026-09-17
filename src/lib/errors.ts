export type DataImportErrorCode =
  | 'unsupported-file-type'
  | 'file-too-large'
  | 'too-many-rows'
  | 'too-many-columns'
  | 'empty-sheet'
  | 'parse-failed'

export class DataImportError extends Error {
  readonly code: DataImportErrorCode

  constructor(code: DataImportErrorCode, message: string) {
    super(message)
    this.name = 'DataImportError'
    this.code = code
  }
}
