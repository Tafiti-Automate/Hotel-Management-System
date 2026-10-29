import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  children: ReactNode
  onHome: () => void
}

interface State {
  failed: boolean
}

/** Prevent a failing business screen from taking down the entire ERP shell. */
export default class WorkspaceErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Workspace rendering error', error, info.componentStack)
    }
  }

  private retry = () => {
    this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section className="neo-screen-failure" role="alert">
        <div className="neo-screen-failure-icon"><Icon name="error_outline" size={28} /></div>
        <h2>This workspace could not be displayed</h2>
        <p>Your records have not been changed. Try opening the workspace again or return to the overview.</p>
        <div className="neo-screen-failure-actions">
          <button type="button" onClick={this.retry}>Try again</button>
          <button type="button" onClick={this.props.onHome}>Back to overview</button>
        </div>
      </section>
    )
  }
}
