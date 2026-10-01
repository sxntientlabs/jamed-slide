import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createAiAgentPlugin } from "./server/aiAgent";
import { createPresentationRendererPlugin } from "./server/presentationRenderer";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), createAiAgentPlugin(env), createPresentationRendererPlugin(env)],
    server: {
      port: 4173,
    },
  };
});
