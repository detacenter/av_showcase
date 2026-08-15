import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8,
          padding: 24, textAlign: "center", color: "#888",
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#ddd" }}>Something went wrong on this page.</div>
          <div style={{ fontSize: 13, color: "#666", maxWidth: 480 }}>{this.state.error.message}</div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 8, padding: "6px 16px", borderRadius: 8,
              border: "1px solid #333", background: "#1e1e1e", color: "#ccc",
              fontSize: 13, cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
