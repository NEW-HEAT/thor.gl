import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { join } from "path";

const root = join(__dirname, "..");
const demoModules = join(__dirname, "node_modules");
const editableLayersRoot = join(__dirname, "../../deck.gl-community/modules/editable-layers");
const editableLayersDeps = join(__dirname, "../../deck.gl-community/node_modules");

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: process.env.GITHUB_ACTIONS ? "/thor.gl/" : "/",
  resolve: {
    alias: [
      // Local source
      { find: "thor.gl", replacement: join(root, "src/index.ts") },
      // editable-layers — alias to src (no build required, vite transforms on the fly)
      {
        find: "@deck.gl-community/editable-layers",
        replacement: join(editableLayersRoot, "src/index.ts"),
      },
      // editable-layers peer deps (turf, zod, etc.) resolve from its own node_modules
      { find: /^zod$/, replacement: join(editableLayersDeps, "zod") },
      // Pin shared deps to demo/node_modules for consistency
      { find: /^react$/, replacement: join(demoModules, "react") },
      { find: /^react-dom$/, replacement: join(demoModules, "react-dom") },
      { find: "@deck.gl/core", replacement: join(demoModules, "@deck.gl/core") },
      { find: "@mediapipe/tasks-vision", replacement: join(demoModules, "@mediapipe/tasks-vision") },
    ],
  },
});
