import { Component, type ErrorInfo, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Last-resort boundary. A render error anywhere would otherwise blank the whole
// app and lose the run in progress. This keeps the page usable and says what
// happened; the run state lives in the store, so a reload restores the rest.
// ---------------------------------------------------------------------------

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[jobpilot] render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-sm leading-relaxed">
        <h1 className="text-2xl font-semibold">Something broke while drawing the page.</h1>
        <p className="mt-2 text-base text-[var(--color-mute)]">
          Reload is safe. Your resume and tracker are saved in this browser.
        </p>
        <pre className="mono mt-3 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3 text-[11px] text-[#ffb4b4]">
          {this.state.error.message}
        </pre>
        <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
