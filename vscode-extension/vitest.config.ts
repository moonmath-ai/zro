import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";
import type { Plugin } from "vite";

/**
 * The extension sources use `.js` on relative imports (`./constants.js`) even
 * though the files are `.ts`. Vite/Rollup won't resolve `./constants.js` to a
 * `.ts` file on its own, so rewrite those specifiers to their `.ts` source.
 */
function resolveJsToTs(): Plugin {
  return {
    name: "resolve-js-to-ts",
    resolveId(source, importer) {
      if (!source.endsWith(".js")) return null;
      const tsPath = source.replace(/\.js$/, ".ts");
      const resolved = importer
        ? path.resolve(path.dirname(importer), tsPath)
        : path.resolve(tsPath);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
      return null;
    }
  };
}

export default defineConfig({
  plugins: [resolveJsToTs()],
  resolve: {
    alias: {
      // The extension sources `import * as vscode from "vscode"`, but that
      // package only ships type declarations. At test runtime we substitute a
      // tiny local stand-in with just the classes/enums the code touches.
      vscode: path.resolve(__dirname, "test/mocks/vscode.ts")
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true
  }
});