const configuredApiBase = String(import.meta.env.VITE_KOASIS_API_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

/**
 * Resolve API routes against the configured backend while keeping local
 * development on the same-origin Vite server by default.
 */
export function koasisApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return configuredApiBase ? `${configuredApiBase}${normalizedPath}` : normalizedPath;
}
