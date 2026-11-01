import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createAiAgentPlugin } from "./server/aiAgent";
import { createKoasisBackendPlugin } from "./server/koasisBackend";
import { createKoasisCorsPlugin } from "./server/koasisCors";
import { createPresentationRendererPlugin } from "./server/presentationRenderer";

export default defineConfig(({ mode }) => {
  // Dokploy injects runtime variables into the process rather than into a
  // Vite .env file. Merge both sources so server plugins receive the same
  // configuration in local, App Hosting, and Dokploy deployments.
  const runtimeEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const env = { ...loadEnv(mode, process.cwd(), ""), ...runtimeEnv };
  const enablePresentationRenderer = env.KOASIS_ENABLE_PRESENTATION_RENDERER === "true";
  const allowedPreviewHosts = env.JAMED_ALLOWED_HOSTS === "*"
    ? true
    : (env.JAMED_ALLOWED_HOSTS || "localhost,127.0.0.1")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean);
  return {
    plugins: [
      react(),
      createKoasisCorsPlugin(env),
      createAiAgentPlugin(env),
      createKoasisBackendPlugin(env),
      ...(enablePresentationRenderer ? [createPresentationRendererPlugin(env)] : []),
    ],
    server: {
      port: 4173,
    },
    preview: {
      allowedHosts: allowedPreviewHosts,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("@firebase/auth") || id.includes("firebase/auth")) return "firebase-auth";
            if (id.includes("@firebase/firestore") || id.includes("firebase/firestore")) return "firebase-firestore";
            if (id.includes("@firebase") || id.includes("/firebase/")) return "firebase-core";
            if (id.includes("lucide-react")) return "icons";
            if (id.includes("jszip")) return "document-engine";
            if (id.includes("react-dom") || id.includes("/react/")) return "react";
            return undefined;
          },
        },
      },
    },
  };
});
