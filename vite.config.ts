import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createAiAgentPlugin } from "./server/aiAgent";
import { createPresentationRendererPlugin } from "./server/presentationRenderer";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const allowedPreviewHosts = (env.JAMED_ALLOWED_HOSTS || "localhost,127.0.0.1")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return {
    plugins: [react(), createAiAgentPlugin(env), createPresentationRendererPlugin(env)],
    server: {
      port: 4173,
    },
    preview: {
      allowedHosts: allowedPreviewHosts,
    },
  };
});
