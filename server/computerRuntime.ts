export type KoasisComputerRuntime = "vps" | "instabox";

export const DEFAULT_COMPUTER_RUNTIME: KoasisComputerRuntime = "vps";

/**
 * Resolve the server-side Computer provider without allowing arbitrary values
 * from environment configuration to change the routing contract.
 *
 * VPS is the safe default for the current stack: the private Hermes container
 * owns the disposable desktop sandbox. Instabox remains an explicit fallback
 * for deployments that still need the shared desktop pool.
 */
export function resolveComputerRuntime(value: unknown): KoasisComputerRuntime {
  return typeof value === "string" && value.trim().toLowerCase() === "instabox"
    ? "instabox"
    : DEFAULT_COMPUTER_RUNTIME;
}
