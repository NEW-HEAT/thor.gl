import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { join } from "path";

const root = join(__dirname, "..");
const demoModules = join(__dirname, "node_modules");
const useHttps = !!process.env.HTTPS;

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  root: __dirname,
  base: "/",
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
