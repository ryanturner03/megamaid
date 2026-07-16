#!/usr/bin/env node

// Dev-friendly entry point: runs TypeScript source directly via tsx.
// For production, use the compiled dist/cli-webnav/index.js via npm link.

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "../src/cli-webnav/index.ts");

try {
  execFileSync("npx", ["tsx", entry, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: resolve(__dirname, ".."),
  });
} catch (err) {
  process.exit(err.status ?? 1);
}
