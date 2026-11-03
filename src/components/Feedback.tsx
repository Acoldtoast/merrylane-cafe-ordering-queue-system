"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "./Icons";

export type FeedbackTone = "loading" | "success" | "error" | "warning" | "info";

export interface FeedbackDetail {
  label: string;
  value: string;
}

export interface FeedbackOptions {
  tone?: FeedbackTone;
  eyebrow?: string;
  title: string;
  message?: string;
  details?: FeedbackDetail[];
  /** How long to keep the card on screen. 0 keeps it until dismissed. */
  duration?: number;
  onDismiss?: () => void;
}

interface FeedbackState extends FeedbackOptions {
  id: number;
  tone: FeedbackTone;
}

export interface RunResult<T> {
  ok: boolean;
  result?: T;
  error?: Error;
}

export interface RunOptions<T> {
  loading?: { title?: string; message?: string; eyebrow?: string };
  success: (result: T) => FeedbackOptions;
  error?: (error: Error) => FeedbackOptions;
}

interface FeedbackApi {
  show: (options: FeedbackOptions) => void;
  success: (
    title: string,
    options?: Omit<FeedbackOptions, "title" | "tone">
  ) => void;
  warning: (
    title: string,
    options?: Omit<FeedbackOptions, "title" | "tone">
  ) => void;
  error: (
    title: string,
    options?: Omit<FeedbackOptions, "title" | "tone">
  ) => void;
  loading: (title: string, message?: string) => void;
  dismiss: () => void;
  run: <T>(task: () => Promise<T>, options: RunOptions<T>) => Promise<RunResult<T>>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

const DEFAULT_DURATION: Record<FeedbackTone, number> = {
  loading: 0,
  success: 2600,
  info: 2600,
  warning: 5200,
  error: 0,
};

const TONE_ICON = {
  success: "check",
  warning: "alert",
  error: "x",
  info: "info",
} as const;

function clockStamp(date: Date) {
  return date.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FeedbackState | null>(null);
  const idRef = useRef(0);
  const okRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<FeedbackState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dismiss = useCallback(() => {
    stateRef.current?.onDismiss?.();
    setState(null);
  }, []);

  const show = useCallback((options: FeedbackOptions) => {
    idRef.current += 1;
    setState({
      ...options,
      tone: options.tone || "info",
      id: idRef.current,
    });
  }, []);

  const success = useCallback<FeedbackApi["success"]>(
    (title, options) => show({ ...options, title, tone: "success" }),
    [show]
  );
  const warning = useCallback<FeedbackApi["warning"]>(
    (title, options) =>
      show({
        ...options,
        title,
        tone: "warning",
        duration: options?.duration ?? DEFAULT_DURATION.warning,
      }),
    [show]
  );
  const error = useCallback<FeedbackApi["error"]>(
    (title, options) => show({ ...options, title, tone: "error" }),
    [show]
  );
  const loading = useCallback<FeedbackApi["loading"]>(
    (title, message) =>
      show({ title, message, tone: "loading", eyebrow: "One moment" }),
    [show]
  );

  const run = useCallback(
    async function run<T>(
      task: () => Promise<T>,
      options: RunOptions<T>
    ): Promise<RunResult<T>> {
      show({
        tone: "loading",
        eyebrow: options.loading?.eyebrow || "One moment",
        title: options.loading?.title || "Saving your changes…",
        message: options.loading?.message,
      });
      try {
        const result = await task();
        show({ tone: "success", eyebrow: "Saved", ...options.success(result) });
        return { ok: true, result };
      } catch (err: unknown) {
        const failure = err instanceof Error ? err : new Error("Something went wrong.");
        const custom = options.error?.(failure);
        show({
          tone: "error",
          eyebrow: "Not saved",
          title: custom?.title || "That didn't save",
          message: custom?.message || failure.message,
          details: custom?.details,
        });
        return { ok: false, error: failure };
      }
    },
    [show]
  );

  const api = useMemo<FeedbackApi>(
    () => ({ show, success, warning, error, loading, dismiss, run }),
    [show, success, warning, error, loading, dismiss, run]
  );

  // Auto-dismiss successes, warnings and info cards once their moment passes.
  useEffect(() => {
    if (!state || state.tone === "loading" || state.tone === "error") return;
    const duration =
      state.duration === 0
        ? 0
        : state.duration ?? DEFAULT_DURATION[state.tone] ?? 2600;
    if (!duration) return;
    const timer = window.setTimeout(() => {
      setState((current) => (current?.id === state.id ? null : current));
    }, duration);
    return () => window.clearTimeout(timer);
  }, [state]);

  // Keep the page still while the dialog is up.
  useEffect(() => {
    if (!state) return;
    document.body.classList.add("no-scroll");
    return () => document.body.classList.remove("no-scroll");
  }, [state]);

  // Sticky warnings require an explicit button click to dismiss.
  useEffect(() => {
    if (
      !state ||
      state.tone === "loading" ||
      (state.tone === "warning" && state.duration === 0)
    ) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, dismiss]);

  useEffect(() => {
    if (!state) return;
    if (state.tone === "error" || (state.tone === "warning" && state.duration === 0)) {
      const timer = window.setTimeout(() => okRef.current?.focus(), 60);
      return () => window.clearTimeout(timer);
    }
    if (state.tone === "warning") {
      const timer = window.setTimeout(() => cardRef.current?.focus(), 60);
      return () => window.clearTimeout(timer);
    }
  }, [state]);

  const tone = state?.tone || "info";
  const stamp = state ? clockStamp(new Date()) : "";
  const duration =
    state && state.tone !== "loading" && state.tone !== "error"
      ? state.duration === 0
        ? 0
        : state.duration ?? DEFAULT_DURATION[state.tone]
      : 0;

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {state && (
        <div
          className={`feedback-layer tone-${tone}`}
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              tone !== "loading" &&
              !(tone === "warning" && state.duration === 0)
            ) {
              dismiss();
            }
          }}
        >
          <div
            ref={cardRef}
            tabIndex={tone === "warning" ? -1 : undefined}
            className={`feedback-card ${
              tone === "warning" || tone === "error" ? "is-shaking" : ""
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            aria-describedby={state.message ? "feedback-message" : undefined}
            data-tone={tone}
            style={
              duration
                ? ({ "--feedback-duration": `${duration}ms` } as React.CSSProperties)
                : undefined
            }
          >
            {tone === "error" && (
              <button
                type="button"
                className="feedback-close"
                aria-label="Close"
                onClick={dismiss}
              >
                <Icon name="x" size={14} />
              </button>
            )}

            <div className="feedback-medallion" aria-hidden="true">
              {tone === "loading" ? (
                <span className="feedback-ring" />
              ) : (
                <Icon name={TONE_ICON[tone]} size={22} />
              )}
            </div>

            {state.eyebrow && (
              <span className="feedback-eyebrow">{state.eyebrow}</span>
            )}
            <h2 id="feedback-title" className="feedback-title">
              {state.title}
            </h2>
            {state.message && (
              <p id="feedback-message" className="feedback-message">
                {state.message}
              </p>
            )}

            {state.details && state.details.length > 0 && (
              <dl className="feedback-details">
                {state.details.map((detail) => (
                  <div key={`${detail.label}-${detail.value}`}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div
              className={`feedback-foot${
                tone !== "loading" && tone !== "error" ? " is-stamp-only" : ""
              }`}
            >
              {tone === "loading" ? (
                <span className="feedback-working">
                  <span className="feedback-dots" aria-hidden="true">
                    <b />
                    <b />
                    <b />
                  </span>
                  Working on it
                </span>
              ) : tone === "error" || (tone === "warning" && state.duration === 0) ? (
                <button
                  ref={okRef}
                  type="button"
                  className="btn btn-primary feedback-ok"
                  onClick={dismiss}
                >
                  Got it
                </button>
              ) : null}
              <span className="feedback-stamp">{stamp}</span>
            </div>

            {duration > 0 && <span className="feedback-progress" aria-hidden="true" />}
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback must be used inside <FeedbackProvider>.");
  }
  return context;
}
