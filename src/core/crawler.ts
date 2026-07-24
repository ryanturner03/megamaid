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

/**
 * Attribution params that identify how a visitor arrived, never which page they
 * landed on. Dropped under preserveQuery so the same topic reached via the
 * search bar and via a TOC link dedupes to one URL instead of being captured
 * twice. Matched case-insensitively; anything starting with "utm_" also goes.
 */
const TRACKING_PARAMS = new Set([
  "_hsenc",
  "_hsmi",
  "hslang",
  "hsctatracking",
  "gclid",
  "fbclid",
  "msclkid",
  "mkt_tok",
  "_ga",
  "_gl",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

export function extractLinks(
  urlMap: Map<string, string>,
  baseUrl: string,
  options: { preserveQuery?: boolean } = {}
): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const links: string[] = [];

  for (const url of urlMap.values()) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== base.hostname) continue;
      const normalized = normalizeLink(parsed, options.preserveQuery ?? false);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push(normalized);
    } catch {
      // Skip invalid URLs
    }
  }

  return links;
}

/**
 * Reduce a URL to its identity for dedup and queueing.
 *
 * By default the query string is discarded: path-addressed doc sites use query
 * params for sorting, filtering, and tracking, and keeping them would explode
 * the frontier with duplicates of the same page.
 *
 * Some portals instead address content BY query string — every document shares
 * one pathname and differs only in its parameters (e.g.
 * /doc-item?bundleId=X&topicId=Y). Those need the opposite: set preserveQuery
 * in the site config, or the whole corpus collapses onto a single URL and the
 * crawl stops after one page. Note that match/exclude patterns are still
 * evaluated against the pathname only, so such sites cannot be filtered by
 * document identity.
 */
function normalizeLink(parsed: URL, preserveQuery: boolean): string {
  const path = parsed.pathname.replace(/\/+$/, "");
  if (!preserveQuery) return `${parsed.origin}${path}`;

  const params = new URLSearchParams(parsed.search);
  for (const key of [...params.keys()]) {
    if (isTrackingParam(key)) params.delete(key);
  }
  const query = params.toString();
  return `${parsed.origin}${path}${query ? `?${query}` : ""}`;
}
