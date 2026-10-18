import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createAiAgentPlugin } from "./server/aiAgent";
import { createKoasisBackendPlugin } from "./server/koasisBackend";
import { createPresentationRendererPlugin } from "./server/presentationRenderer";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const allowedPreviewHosts = env.JAMED_ALLOWED_HOSTS === "*"
    ? true
    : (env.JAMED_ALLOWED_HOSTS || "localhost,127.0.0.1")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean);
  return {
    plugins: [react(), createAiAgentPlugin(env), createKoasisBackendPlugin(env), createPresentationRendererPlugin(env)],
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
