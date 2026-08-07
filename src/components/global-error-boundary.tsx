import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/client-error-reporter";
import { Chip } from "@/components/ui/chip";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

function isSensitiveKey(key: string): boolean {
  return /token|authorization|cookie|password|secret|key/i.test(key);
}

function safeDescribeValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (typeof value === "object") return "[object]";
  return typeof value;
}

function describeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  if (typeof Response !== "undefined" && error instanceof Response) {
    return {
      type: "Response",
      status: error.status,
      statusText: error.statusText,
      url: error.url,
    };
  }

  if (!error || typeof error !== "object") {
    return { type: typeof error, value: String(error) };
  }

  const record = error as Record<string, unknown>;
  const details: Record<string, unknown> = {
    type: Object.prototype.toString.call(error),
    constructorName: error.constructor?.name,
  };

  for (const key of Object.keys(record).slice(0, 20)) {
    details[key] = isSensitiveKey(key) ? "[redacted]" : safeDescribeValue(record[key]);
  }

  return details;
}

function normalizeUnknownError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return new Error(typeof message === "string" ? message : "Unknown error");
  }
  if (error && typeof error === "object") {
    const name = error.constructor?.name ?? Object.prototype.toString.call(error);
    return new Error(`Non-Error thrown: ${name}`);
  }
  return new Error(`Non-Error thrown: ${String(error)}`);
}

export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: normalizeUnknownError(error).message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const thrownValue = describeUnknownError(error);
    console.error("[GlobalErrorBoundary]", thrownValue);
    reportError(normalizeUnknownError(error), {
      metadata: {
        type: "react.errorBoundary",
        componentStack: info.componentStack,
        thrownValue,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">
            Something broke
          </p>
          <h1 className="font-display text-h2 text-text-primary mt-3">Sorry — we hit an error</h1>
          <p className="text-text-secondary mt-3">
            We've been notified and are looking into it. Try reloading the page.
          </p>
          <Chip tone="accent" className="mt-6" onClick={() => window.location.reload()}>
            Reload
          </Chip>
        </div>
      );
    }
    return this.props.children;
  }
}
