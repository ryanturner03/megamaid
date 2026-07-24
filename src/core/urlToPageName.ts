// src/core/urlToPageName.ts
import { createHash } from "crypto";

/**
 * Derive the on-disk name for a page (its snapshot file and its image folder)
 * from the page URL.
 *
 * Path-addressed URLs keep the historical name — the pathname with separators
 * flattened to hyphens — so existing corpora are unaffected.
 *
 * URLs carrying a query string get a short hash of that query appended. Portals
 * that address content BY query — every document sharing one pathname and
 * differing only in its parameters (e.g. /doc-item?bundleId=X&topicId=Y) —
 * otherwise map every document onto one filename and silently overwrite each
 * other; a 5-page crawl left 2 files on disk. The hash rather than the raw query keeps
 * names bounded and filesystem-safe, and it is applied AFTER the 80-character
 * truncation so truncation can't reintroduce a collision.
 *
 * Lives in its own module because both snapshotWriter (names the .json) and
 * megamaid (names the images/ subfolder) must agree; they previously carried
 * separate copies of this logic.
 */
export function urlToPageName(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .filter(Boolean);

    const base =
      pathParts.length === 0
        ? parsed.hostname.replace(/\./g, "-")
        : pathParts
            .join("-")
            .replace(/[^a-zA-Z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .substring(0, 80);

    if (!parsed.search || parsed.search === "?") return base;

    const digest = createHash("sha1").update(parsed.search).digest("hex").slice(0, 8);
    return `${base}-${digest}`;
  } catch {
    return "page";
  }
}
