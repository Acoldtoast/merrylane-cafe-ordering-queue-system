export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Keep Node-only scheduler dependencies out of the Edge instrumentation bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./instrumentation.node");
  }
}
