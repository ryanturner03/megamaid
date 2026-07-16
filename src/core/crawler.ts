// src/core/crawler.ts
import { minimatch } from "minimatch";

/**
 * Match a URL pathname against a glob pattern. Supports two pattern languages:
 * - Minimatch globs (default): "/docs/**", "**\/*Reference*", etc.
 * - Regex (when prefixed with "re:"): "re:^/r/[A-Za-z0-9_~]{20,24}(/|$)"
 *
 * The regex form is an escape hatch for patterns minimatch can't express
 * (e.g. fixed-length opaque IDs). The "re:" prefix is stripped and the rest
 * is passed to RegExp; invalid regexes return false rather than throwing.
 */
export function matchesPattern(urlPath: string, pattern: string): boolean {
  if (pattern.startsWith("re:")) {
    try {
      return new RegExp(pattern.slice(3)).test(urlPath);
    } catch {
      return false;
    }
  }
  if (minimatch(urlPath, pattern)) return true;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    if (urlPath === prefix || urlPath === prefix + "/") return true;
  }
  return false;
}

export function extractLinks(
  urlMap: Map<string, string>,
  baseUrl: string
): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const links: string[] = [];

  for (const url of urlMap.values()) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== base.hostname) continue;
      const normalized = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push(normalized);
    } catch {
      // Skip invalid URLs
    }
  }

  return links;
}
