// src/core/siteConfigResolver.ts
import { existsSync } from "fs";
import path from "path";

/**
 * Resolve a site config path. Accepts:
 *   - A direct file path: "./sites/falcon.toml" or "/abs/path/config.toml"
 *   - A bare name: "falcon" → checks ~/.megamaid/sites/falcon.toml, then ./sites/falcon.toml
 *
 * If the input is a bare name and no file is found, returns the global candidate
 * path (~/.megamaid/sites/<name>.toml) so callers can produce a clear error.
 */
export async function resolveSiteConfigPath(input: string): Promise<string> {
  // If it looks like a path (has extension or separator), use directly
  if (input.includes("/") || input.includes("\\") || input.match(/\.\w+$/)) {
    return path.resolve(input);
  }
  // Bare name — check ~/.megamaid/sites/ first, then local sites/
  const { homedir } = await import("os");
  const globalCandidate = path.join(homedir(), ".megamaid", "sites", `${input}.toml`);
  if (existsSync(globalCandidate)) {
    return globalCandidate;
  }
  const localCandidate = path.resolve("sites", `${input}.toml`);
  if (existsSync(localCandidate)) {
    return localCandidate;
  }
  // Not found — return global path for a clear error message
  return globalCandidate;
}
