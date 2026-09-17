import { useRef, useState } from 'react'
import type { Dataset } from '../../domain/data'
import { DataImportError } from '../../lib/errors'
import {
  importCsvFile,
  importWorkbookSheets,
  isCsvFile,
  isXlsxFile,
  listWorkbookSheets,
  loadSampleRetailDataset,
} from '../../runtime/data/dataRuntime'

interface PendingWorkbook {
  file: File
  sheets: string[]
  selected: Set<string>
}

interface ImportDataPanelProps {
  onImportDataset: (dataset: Dataset) => unknown
  compact?: boolean
}

export function ImportDataPanel({ onImportDataset, compact = false }: ImportDataPanelProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingWorkbook, setPendingWorkbook] = useState<PendingWorkbook | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function reportError(err: unknown) {
    if (err instanceof DataImportError) {
      setError(err.message)
    } else {
      const detail = err instanceof Error ? err.message : String(err)
      setError(`Unable to parse file: ${detail}`)
    }
  }

  async function handleFiles(fileList: FileList | File[]) {
    setError(null)
    const files = Array.from(fileList)
    if (files.length === 0) return

    const xlsxFile = files.find(isXlsxFile)
    const csvFiles = files.filter(isCsvFile)
    const unsupported = files.filter((file) => !isCsvFile(file) && !isXlsxFile(file))

    if (unsupported.length > 0) {
      setError(`Unsupported file type: "${unsupported[0].name}". Import a .csv or .xlsx file.`)
    }

    setBusy(true)
    try {
      for (const file of csvFiles) {
        const dataset = await importCsvFile(file)
        await onImportDataset(dataset)
      }
      if (xlsxFile) {
        const sheets = await listWorkbookSheets(xlsxFile)
        setPendingWorkbook({ file: xlsxFile, sheets, selected: new Set(sheets) })
      }
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  function toggleSheet(sheetName: string) {
    setPendingWorkbook((current) => {
      if (!current) return current
      const selected = new Set(current.selected)
      if (selected.has(sheetName)) {
        selected.delete(sheetName)
      } else {
        selected.add(sheetName)
      }
      return { ...current, selected }
    })
  }

  async function confirmWorkbookImport() {
    if (!pendingWorkbook || pendingWorkbook.selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const datasets = await importWorkbookSheets(pendingWorkbook.file, [...pendingWorkbook.selected])
      for (const dataset of datasets) {
        await onImportDataset(dataset)
      }
      setPendingWorkbook(null)
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleLoadSample() {
    setBusy(true)
    setError(null)
    try {
      const datasets = loadSampleRetailDataset()
      for (const dataset of datasets) {
        await onImportDataset(dataset)
      }
    } catch (err) {
      reportError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`import-panel ${compact ? 'import-panel--compact' : ''}`}>
      <div
        className={`dropzone ${isDragOver ? 'dropzone--active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragOver(false)
          void handleFiles(event.dataTransfer.files)
        }}
      >
        <p className="dropzone__title">Drop CSV / Excel here</p>
        <p className="dropzone__hint">or</p>
        <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()} disabled={busy}>
          + Add Data
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      <div className="import-panel__sample">
        <p>Try a sample dataset</p>
        <button type="button" className="secondary-button" onClick={handleLoadSample} disabled={busy}>
          Load Retail Dataset
        </button>
      </div>

      {error && <p className="import-panel__error" role="alert">{error}</p>}

      {pendingWorkbook && (
        <div className="sheet-picker">
          <p className="sheet-picker__title">Sheets in "{pendingWorkbook.file.name}"</p>
          <ul className="sheet-picker__list">
            {pendingWorkbook.sheets.map((sheet) => (
              <li key={sheet}>
                <label>
                  <input
                    type="checkbox"
                    checked={pendingWorkbook.selected.has(sheet)}
                    onChange={() => toggleSheet(sheet)}
                  />
                  {sheet}
                </label>
              </li>
            ))}
          </ul>
          <div className="sheet-picker__actions">
            <button type="button" className="secondary-button" onClick={() => setPendingWorkbook(null)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={confirmWorkbookImport}
              disabled={busy || pendingWorkbook.selected.size === 0}
            >
              Import selected sheets
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
