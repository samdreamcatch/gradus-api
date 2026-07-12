import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '@/lib/client-error-reporter'
import { Chip } from '@/components/ui/chip'



interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  message?: string
}

export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, {
      metadata: { type: 'react.errorBoundary', componentStack: info.componentStack },
    })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">
            Something broke
          </p>
          <h1 className="font-display text-h2 text-text-primary mt-3">
            Sorry — we hit an error
          </h1>
          <p className="text-text-secondary mt-3">
            We've been notified and are looking into it. Try reloading the page.
          </p>
          <Chip
            tone="accent"
            className="mt-6"
            onClick={() => window.location.reload()}
          >
            Reload
          </Chip>

        </div>
      )
    }
    return this.props.children
  }
}
