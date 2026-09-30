// tests/unit/crawler.test.ts
import { describe, it, expect } from "vitest";
import { matchesPattern, extractLinks, canonicalFor } from "../../src/core/crawler.js";

describe("matchesPattern", () => {
  it("matches glob patterns against URL paths", () => {
    expect(matchesPattern("/blog/post-1", "/blog/*")).toBe(true);
    expect(matchesPattern("/blog/post-1", "/products/*")).toBe(false);
    expect(matchesPattern("/docs/api/v2/users", "/docs/**")).toBe(true);
  });

  it("matches regex patterns when prefixed with re:", () => {
    // Opaque hash IDs (length-bounded char class — globs can't express this)
    const pat = "re:^/r/[A-Za-z0-9_~]{20,24}(/|$)";
    expect(matchesPattern("/r/GD6sG6FlxDWxAn13_eZuU/anything", pat)).toBe(true);
    expect(matchesPattern("/r/Xbu0UIqvwmrs~L_Pss5Ljw", pat)).toBe(true);
    expect(matchesPattern("/r/Cortex-XSIAM-Documentation/foo", pat)).toBe(false);
    expect(matchesPattern("/r/short/foo", pat)).toBe(false);
  });

  it("returns false for invalid regex instead of throwing", () => {
    expect(matchesPattern("/anything", "re:[unclosed")).toBe(false);
  });
});

describe("extractLinks", () => {
  it("extracts links from accessibility tree snapshot", () => {
    const urlMap = new Map([
      ["0-10", "https://example.com/page-1"],
      ["0-20", "https://example.com/page-2"],
      ["0-30", "https://other.com/external"],
    ]);

    const links = extractLinks(urlMap, "https://example.com");
    expect(links).toContain("https://example.com/page-1");
    expect(links).toContain("https://example.com/page-2");
    expect(links).not.toContain("https://other.com/external"); // external
  });

  it("deduplicates URLs", () => {
    const urlMap = new Map([
      ["0-10", "https://example.com/page-1"],
      ["0-20", "https://example.com/page-1"], // duplicate
    ]);

    const links = extractLinks(urlMap, "https://example.com");
    expect(links.length).toBe(1);
  });

  it("discards query strings by default", () => {
    // Path-addressed sites (the norm): query params are sort/filter/tracking
    // noise, and collapsing them keeps the frontier bounded.
    const urlMap = new Map([
      ["0-10", "https://example.com/docs?sort=asc"],
      ["0-20", "https://example.com/docs?sort=desc"],
    ]);

    const links = extractLinks(urlMap, "https://example.com");
    expect(links).toEqual(["https://example.com/docs"]);
  });
});

describe("extractLinks with preserveQuery", () => {
  // Some portals address every doc by query string, sharing one pathname:
  // /s/document-item?bundleId=X&topicId=Y. Without preserveQuery an entire
  // corpus collapses to a single URL.
  it("treats distinct query strings as distinct pages", () => {
    const urlMap = new Map([
      ["0-10", "https://help.example.com/s/document-item?bundleId=uml165&topicId=fcb165.html"],
      ["0-20", "https://help.example.com/s/document-item?bundleId=uml165&topicId=abc999.html"],
      ["0-30", "https://help.example.com/s/document-item?bundleId=nmc164&topicId=ksr164.html"],
    ]);

    const links = extractLinks(urlMap, "https://help.example.com", { preserveQuery: true });
    expect(links.length).toBe(3);
    expect(links).toContain(
      "https://help.example.com/s/document-item?bundleId=uml165&topicId=fcb165.html"
    );
  });

  it("strips tracking params before deduplicating", () => {
    // Both links point at the same topic; only the search-bar attribution
    // differs. Without stripping, the same page is captured twice.
    const urlMap = new Map([
      ["0-10", "https://help.example.com/s/document-item?bundleId=nmc164&topicId=ksr164.html"],
      [
        "0-20",
        "https://help.example.com/s/document-item?bundleId=nmc164&topicId=ksr164.html&utm_source=searchbar&utm_medium=faq",
      ],
      ["0-30", "https://help.example.com/s/documents?page=1&_hsenc=p2ANqtz-9&hsLang=en"],
    ]);

    const links = extractLinks(urlMap, "https://help.example.com", { preserveQuery: true });
    expect(links).toEqual([
      "https://help.example.com/s/document-item?bundleId=nmc164&topicId=ksr164.html",
      "https://help.example.com/s/documents?page=1",
    ]);
  });

  it("keeps the bare path when only tracking params were present", () => {
    const urlMap = new Map([["0-10", "https://help.example.com/s/answers?utm_medium=email"]]);

    const links = extractLinks(urlMap, "https://help.example.com", { preserveQuery: true });
    expect(links).toEqual(["https://help.example.com/s/answers"]);
  });

  it("still rejects cross-host links", () => {
    const urlMap = new Map([
      ["0-10", "https://help.example.com/s/csh?context=afb410"],
      ["0-20", "https://www.other-host.com/blog?utm_source=docs"],
    ]);

    const links = extractLinks(urlMap, "https://help.example.com", { preserveQuery: true });
    expect(links).toEqual(["https://help.example.com/s/csh?context=afb410"]);
  });
});

describe("canonicalFor", () => {
  // A help centre that redirects /articles/<id> and stale slugs to
  // /articles/<id>-<current-slug>, and bounces logged-out visitors to sign-in.
  const scope = {
    startUrl: "https://example.com/hc",
    match: ["/hc/**"],
    exclude: ["/hc/private/**"],
  };
  const canonical = "https://example.com/hc/articles/1-title";

  it("returns the requested URL when the page did not redirect", () => {
    expect(canonicalFor(canonical, canonical, scope)).toBe(canonical);
  });

  it("returns the landed URL for an in-scope redirect from a bare ID", () => {
    expect(canonicalFor("https://example.com/hc/articles/1", canonical, scope)).toBe(canonical);
  });

  it("returns the landed URL for an old slug redirected to the new slug", () => {
    expect(canonicalFor("https://example.com/hc/articles/1-old", canonical, scope)).toBe(canonical);
  });

  it("keeps the requested URL when redirected to an out-of-scope sign-in page", () => {
    const requested = "https://example.com/hc/articles/1";
    const landed = "https://example.com/auth/signin?return_to=%2Fhc%2Farticles%2F1";
    expect(canonicalFor(requested, landed, scope)).toBe(requested);
  });

  it("keeps the requested URL when redirected to another origin", () => {
    const requested = "https://example.com/hc/articles/1";
    expect(canonicalFor(requested, "https://login.example.net/hc/articles/1", scope)).toBe(requested);
    expect(canonicalFor(requested, "http://example.com/hc/articles/1-title", scope)).toBe(requested);
  });

  it("keeps the requested URL when redirected to an excluded path", () => {
    const requested = "https://example.com/hc/articles/1";
    expect(canonicalFor(requested, "https://example.com/hc/private/1", scope)).toBe(requested);
  });

  it("applies no match filter when match is undefined", () => {
    const requested = "https://example.com/hc/articles/1";
    expect(canonicalFor(requested, "https://example.com/other/1", { startUrl: scope.startUrl })).toBe(
      "https://example.com/other/1"
    );
  });

  it("normalises the landed URL like extractLinks: fragment, query, trailing slash dropped", () => {
    expect(
      canonicalFor("https://example.com/hc/articles/1", `${canonical}/?sort=asc#section-2`, scope)
    ).toBe(canonical);
  });

  it("treats a landed URL that normalises to the requested one as no redirect", () => {
    const requested = "https://example.com/hc/articles/1-title";
    expect(canonicalFor(requested, `${requested}/#top`, scope)).toBe(requested);
    // A requested URL carrying a query (e.g. a start URL) is not rewritten
    // just because normalisation would drop that query.
    const withQuery = "https://example.com/hc?locale=en";
    expect(canonicalFor(withQuery, withQuery, scope)).toBe(withQuery);
  });

  it("keeps identity query params and drops tracking params under preserveQuery", () => {
    const qScope = { startUrl: "https://example.com/doc-item", preserveQuery: true };
    expect(
      canonicalFor(
        "https://example.com/doc-item?topicId=1",
        "https://example.com/doc-item?topicId=1&v=2&utm_source=x#frag",
        qScope
      )
    ).toBe("https://example.com/doc-item?topicId=1&v=2");
    expect(
      canonicalFor(
        "https://example.com/doc-item?topicId=1",
        "https://example.com/doc-item?topicId=1&utm_source=x",
        qScope
      )
    ).toBe("https://example.com/doc-item?topicId=1");
  });

  it("returns the requested URL when the landed URL is unparseable", () => {
    const requested = "https://example.com/hc/articles/1";
    expect(canonicalFor(requested, "about:blank", scope)).toBe(requested);
    expect(canonicalFor(requested, "not a url", scope)).toBe(requested);
  });
});
