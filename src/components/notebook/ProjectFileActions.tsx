import { useRef, useState } from 'react'
import type { NotebookDocument } from '../../domain/notebook'
import { serializeProjectBundle } from '../../runtime/bundle/bundleCodec'
import { useNotebookRuntime } from '../../runtime/notebook/useNotebookRuntime'

type NotebookActions = ReturnType<typeof useNotebookRuntime>['actions']

interface ProjectFileActionsProps {
  notebook: NotebookDocument
  actions: NotebookActions
}

function sanitizeFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'bi-notebook-lab-project'}.bilab.json`
}

/**
 * Export/import for the portable `.bilab.json` project bundle (Sprint 16,
 * brief Part A §8). Deliberately "import as new project" only — importing
 * always replaces the active Free Lab workspace, never merges into it
 * (brief §6), so it asks for confirmation before overwriting local work.
 */
export function ProjectFileActions({ notebook, actions }: ProjectFileActionsProps) {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    setBusy('export')
    setError(null)
    setNotice(null)
    try {
      const bundle = await actions.exportProject(notebook.title, notebook.description || undefined)
      const blob = new Blob([serializeProjectBundle(bundle)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = sanitizeFileName(notebook.title)
      link.click()
      URL.revokeObjectURL(url)
      setNotice('Project exported.')
    } catch (err) {
      setError(`Unable to export project: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleFileSelected(file: File) {
    setError(null)
    setNotice(null)
    if (notebook.cells.length > 0) {
      const confirmed = window.confirm('Importing a project replaces everything currently in this Free Lab workspace. Continue?')
      if (!confirmed) return
    }

    setBusy('import')
    try {
      const text = await file.text()
      const result = await actions.importProject(text)
      if (!result.imported) {
        setError(result.error.message)
        return
      }
      setNotice('Project imported.')
    } catch (err) {
      setError(`Unable to import project: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="project-file-actions">
      <div className="project-file-actions__buttons">
        <button type="button" className="secondary-button" onClick={handleExport} disabled={busy !== null}>
          {busy === 'export' ? 'Exporting…' : 'Export project'}
        </button>
        <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
          {busy === 'import' ? 'Importing project…' : 'Import project'}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.bilab.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFileSelected(file)
          event.target.value = ''
        }}
      />
      {error && <p className="import-panel__error" role="alert">{error}</p>}
      {notice && !error && <p className="project-file-actions__notice" role="status">{notice}</p>}
    </div>
  )
}
