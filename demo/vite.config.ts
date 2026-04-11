import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { join } from "path";

const root = join(__dirname, "..");
const demoModules = join(__dirname, "node_modules");

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: process.env.GITHUB_ACTIONS ? "/thor.gl/" : "/",
  server: {
    // HTTPS is required for camera APIs when accessing from another device
    // on the LAN. Vite generates a self-signed cert automatically.
    // Accept the browser warning on the remote machine.
    https: !!process.env.HTTPS,
  },
  resolve: {
    alias: {
      // Local source
      "thor.gl": join(root, "src/index.ts"),
      // Pin peer deps to demo/node_modules (same pattern as deck.gl-community)
      react: join(demoModules, "react"),
      "react-dom": join(demoModules, "react-dom"),
      "@deck.gl/core": join(demoModules, "@deck.gl/core"),
      "@mediapipe/tasks-vision": join(demoModules, "@mediapipe/tasks-vision"),
    },
  },
});
