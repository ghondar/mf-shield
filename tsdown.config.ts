import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.tsx",
    federation: "src/federation.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["react", "react/jsx-runtime", "@module-federation/runtime"]
});
