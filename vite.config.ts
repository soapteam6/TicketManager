import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin"

// https://vite.dev/config/
export default defineConfig(({mode}) => ({
  envDir: mode === "review" ? false : undefined,
  plugins: [react(), powerApps()],
}));
