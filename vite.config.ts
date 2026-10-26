import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin"

// https://vite.dev/config/
export default defineConfig(({mode}) => ({
  envDir: mode === "review" ? false : undefined,
  server: { watch: { ignored: ['**/design-artifacts.local/**'] } },
  plugins: [react(), powerApps()],
}));
