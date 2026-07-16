import { describe, it, expect } from "vitest";
import { extractLinks, matchesPattern } from "../../src/core/crawler.js";

describe("single-pass link discovery from snapshot urlMap", () => {
  it("extracts same-origin links from snapshot urlMap records", () => {
    const urlMapRecord: Record<string, string> = {
      "0-10": "https://example.com/docs/page-1",
      "0-20": "https://example.com/docs/page-2",
      "0-30": "https://other.com/external",
      "0-40": "https://example.com/blog/post",
    };

    const urlMap = new Map(Object.entries(urlMapRecord));
    const links = extractLinks(urlMap, "https://example.com");

    expect(links).toContain("https://example.com/docs/page-1");
    expect(links).toContain("https://example.com/docs/page-2");
    expect(links).toContain("https://example.com/blog/post");
    expect(links).not.toContain("https://other.com/external");
  });

  it("filters discovered links by match pattern before queueing", () => {
    const links = [
      "https://example.com/docs/page-1",
      "https://example.com/docs/nested/page-2",
      "https://example.com/blog/post",
      "https://example.com/docs",
    ];

    const match = ["/docs/**"];
    const queued = links.filter((link) => {
      const linkPath = new URL(link).pathname;
      return match.some((p) => matchesPattern(linkPath, p));
    });

    expect(queued).toContain("https://example.com/docs/page-1");
    expect(queued).toContain("https://example.com/docs/nested/page-2");
    expect(queued).toContain("https://example.com/docs"); // prefix match
    expect(queued).not.toContain("https://example.com/blog/post");
  });

  it("does not queue already-discovered URLs", () => {
    const discovered = new Set([
      "https://example.com/docs",
      "https://example.com/docs/page-1",
    ]);

    const newLinks = [
      "https://example.com/docs/page-1", // already discovered
      "https://example.com/docs/page-2", // new
    ];

    const added: string[] = [];
    for (const link of newLinks) {
      if (!discovered.has(link)) {
        discovered.add(link);
        added.push(link);
      }
    }

    expect(added).toEqual(["https://example.com/docs/page-2"]);
    expect(discovered.size).toBe(3);
  });
});

describe("crawl link filter with exclude patterns", () => {
  // Mirror of the filter logic in Megamaid.crawlAndSnapshot.
  // Keeping it pure here lets us test the include/exclude combiner in isolation.
  function shouldQueue(url: string, match: string[] | undefined, exclude: string[] | undefined): boolean {
    const pathname = new URL(url).pathname;
    if (match && !match.some((p) => matchesPattern(pathname, p))) return false;
    if (exclude && exclude.some((p) => matchesPattern(pathname, p))) return false;
    return true;
  }

  it("queues URLs that match include and are not excluded", () => {
    expect(shouldQueue("https://example.com/docs/intro", ["/docs/**"], ["/docs/legacy/**"])).toBe(true);
  });

  it("rejects URLs matching an exclude pattern even if they match include", () => {
    expect(shouldQueue("https://example.com/docs/legacy/v1", ["/docs/**"], ["/docs/legacy/**"])).toBe(false);
  });

  it("rejects URLs matching any exclude pattern in the array", () => {
    expect(
      shouldQueue("https://example.com/docs/api/changelog", ["/docs/**"], ["/docs/legacy/**", "/docs/**/changelog"])
    ).toBe(false);
  });

  it("queues when match is undefined and no exclude matches", () => {
    expect(shouldQueue("https://example.com/anywhere", undefined, ["/docs/legacy/**"])).toBe(true);
  });

  it("rejects when match is undefined but exclude matches", () => {
    expect(shouldQueue("https://example.com/docs/legacy/foo", undefined, ["/docs/legacy/**"])).toBe(false);
  });

  it("queues when include matches and exclude is undefined", () => {
    expect(shouldQueue("https://example.com/docs/intro", ["/docs/**"], undefined)).toBe(true);
  });

  it("queues URLs matching any of multiple match patterns", () => {
    const match = ["/category/shop/**", "/product-detail/**"];
    expect(shouldQueue("https://example.com/category/shop/deli", match, undefined)).toBe(true);
    expect(shouldQueue("https://example.com/product-detail/item-123", match, undefined)).toBe(true);
    expect(shouldQueue("https://example.com/account/settings", match, undefined)).toBe(false);
  });

  it("applies exclude patterns alongside multiple match patterns", () => {
    const match = ["/docs/**", "/api/**"];
    const exclude = ["/docs/legacy/**"];
    expect(shouldQueue("https://example.com/docs/intro", match, exclude)).toBe(true);
    expect(shouldQueue("https://example.com/api/v2/users", match, exclude)).toBe(true);
    expect(shouldQueue("https://example.com/docs/legacy/old", match, exclude)).toBe(false);
    expect(shouldQueue("https://example.com/blog/post", match, exclude)).toBe(false);
  });
});
