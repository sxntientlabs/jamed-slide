const configuredApiBase = String(import.meta.env.VITE_KOASIS_API_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const configuredComputerApiBase = String(import.meta.env.VITE_KOASIS_COMPUTER_API_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

function deploymentBasePath(): string {
  const baseUrl = String(import.meta.env.BASE_URL || "/").trim();
  if (!baseUrl || baseUrl === "/") return "";
  return `/${baseUrl.replace(/^\/+|\/+$/g, "")}`;
}

/**
 * Resolve API routes against the configured backend while keeping local
 * development on the same-origin Vite server by default.
 */
export function koasisApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return configuredApiBase ? `${configuredApiBase}${normalizedPath}` : `${deploymentBasePath()}${normalizedPath}`;
}

/**
 * Resolve Computer routes separately so App Hosting can keep the database
 * private inside Dokploy while the rest of the lightweight API stays
 * same-origin.
 */
export function koasisComputerApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return configuredComputerApiBase ? `${configuredComputerApiBase}${normalizedPath}` : `${deploymentBasePath()}${normalizedPath}`;
}
