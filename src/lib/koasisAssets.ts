const basePath = String(import.meta.env.BASE_URL || "/").trim() || "/";

/** Resolve a public asset through Vite's configured deployment base path. */
export function koasisAssetUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return `${normalizedBase}${normalizedPath}`;
}
