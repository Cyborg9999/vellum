import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] uncaught:", error, info);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  reset = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  reload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-screen w-screen bg-vellum-bg text-vellum-text flex items-center justify-center p-10 overflow-auto">
        <div className="w-full max-w-2xl">
          <div className="text-vellum-accent text-xs tracking-[0.3em] font-bold mb-2">
            VELLUM
          </div>
          <div className="text-red-400 text-2xl font-bold mb-4">
            渲染崩溃
          </div>
          <div className="text-vellum-muted text-sm mb-6">
            页面里某个组件抛了未捕获错误，整个 UI 被熔断保护。这通常意味着代码 bug 或 store/DB 状态不一致。
          </div>
          <div className="border border-red-900/60 bg-red-950/20 rounded p-4 mb-4">
            <div className="text-[10px] uppercase tracking-wider text-red-400 mb-1.5">
              error
            </div>
            <div className="font-mono text-xs text-red-300 break-all">
              {this.state.error?.name}: {this.state.error?.message}
            </div>
            {this.state.error?.stack && (
              <details className="mt-3">
                <summary className="text-[10px] uppercase tracking-wider text-vellum-faint cursor-pointer hover:text-vellum-muted">
                  stack trace
                </summary>
                <pre className="mt-2 text-[10px] font-mono text-vellum-muted whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            {this.state.componentStack && (
              <details className="mt-2">
                <summary className="text-[10px] uppercase tracking-wider text-vellum-faint cursor-pointer hover:text-vellum-muted">
                  component stack
                </summary>
                <pre className="mt-2 text-[10px] font-mono text-vellum-muted whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                  {this.state.componentStack}
                </pre>
              </details>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="px-4 py-2 rounded text-xs bg-vellum-accent hover:bg-vellum-accent-hover text-black font-bold transition"
            >
              Try again
            </button>
            <button
              onClick={this.reload}
              className="px-4 py-2 rounded text-xs border border-vellum-border text-vellum-muted hover:text-vellum-text hover:bg-vellum-elevated transition"
            >
              Reload app
            </button>
          </div>
          <div className="text-[10px] text-vellum-faint mt-6 leading-relaxed">
            数据安全：项目和图片库存在 SQLite，刷新不会丢。如果反复崩溃，把上面 stack 截图给开发者。
          </div>
        </div>
      </div>
    );
  }
}
