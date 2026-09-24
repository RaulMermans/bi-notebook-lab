import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-level render-failure boundary (Sprint 16, brief Part F §37). Its job
 * is not to hide runtime bugs — it exists only so a single rendering
 * exception in one workspace surface can't turn the whole application into
 * an unrecoverable blank screen. Diagnostic detail (the stack) is shown only
 * in development; production sees the plain recovery message.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('BI Notebook Lab: unhandled render error', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="error-boundary">
        <h1>Something went wrong in this workspace</h1>
        <p>Your data is still saved locally. Reloading usually recovers from this.</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>
          Reload
        </button>
        {import.meta.env.DEV && (
          <pre className="error-boundary__details">{this.state.error.stack ?? this.state.error.message}</pre>
        )}
      </div>
    )
  }
}
