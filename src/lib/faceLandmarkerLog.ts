/** MediaPipe writes this informational TensorFlow Lite message to stderr. */
function filteredLogger(original: typeof console.error): typeof console.error {
  return (...args: unknown[]) => {
    const message = typeof args[0] === "string"
      ? args[0].replace(/\x1b\[[0-9;]*m/g, "").trim()
      : "";
    if (/^(?:INFO:\s*)?Created TensorFlow Lite XNNPACK delegate for CPU\.?$/.test(message)) return;
    original.apply(console, args);
  };
}

export function runWithoutTfliteInfo<T>(operation: () => T): T {
  const original = console.error;
  console.error = filteredLogger(original);
  try { return operation(); } finally { console.error = original; }
}

/** The WASM runtime binds console.error during initialization. */
export async function initializeWithoutTfliteInfo<T>(operation: () => Promise<T>): Promise<T> {
  const original = console.error;
  const filtered = filteredLogger(original);
  console.error = filtered;
  try { return await operation(); } finally {
    if (console.error === filtered) console.error = original;
  }
}
