function deploymentBasePath(): string {
  const baseUrl = String(import.meta.env.BASE_URL || "/").trim();
  if (!baseUrl || baseUrl === "/") return "";
  const configuredPath = `/${baseUrl.replace(/^\/+|\/+$/g, "")}`;
  if (typeof window !== "undefined") {
    const currentPath = window.location.pathname;
    if (currentPath !== configuredPath && !currentPath.startsWith(`${configuredPath}/`)) return "";
  }
  return configuredPath;
}

/** Resolve a public asset through the active deployment path. */
export function koasisAssetUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const basePath = deploymentBasePath();
  const normalizedBase = basePath ? `${basePath}/` : "/";
  return `${normalizedBase}${normalizedPath}`;
}
