import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  target: "node20",
  clean: true,
  outputOptions: {
    banner: "#!/usr/bin/env node",
  },
});
