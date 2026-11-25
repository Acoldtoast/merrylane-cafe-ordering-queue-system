"use client";

import { createContext, useContext } from "react";

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

export interface FeedbackApi {
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

// Keep the context identity independent of edits to the provider's UI.
export const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback must be used inside <FeedbackProvider>.");
  }
  return context;
}
