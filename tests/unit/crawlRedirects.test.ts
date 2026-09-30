// tests/unit/crawlRedirects.test.ts
//
// Drives Megamaid.crawlAndSnapshot end to end against a fake browser, to check
// how the crawl loop records pages whose URL redirects to another URL.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

// ── Fake site ──
// redirects: requested URL → URL the browser lands on.
// links: page URL (as landed) → links found on that page.
const site = {
  redirects: new Map<string, string>(),
  links: new Map<string, string[]>(),
};
const navigated: string[] = [];
let currentUrl = "about:blank";

vi.mock("../../src/core/browser.js", () => ({
  connectBrowser: vi.fn(async () => ({
    page: { url: () => currentUrl, title: async () => `Title of ${currentUrl}` },
  })),
  navigateTo: vi.fn(async (_page: unknown, url: string) => {
    navigated.push(url);
    currentUrl = site.redirects.get(url) ?? url;
  }),
  settleOnly: vi.fn(async () => {}),
  closeBrowser: vi.fn(async () => {}),
  humanDelay: vi.fn(async () => {}),
  dismissCookieBanners: vi.fn(async () => {}),
}));

vi.mock("../../src/core/snapshot/capture.js", () => ({
  captureAxTree: vi.fn(async () => []),
  captureAxTreeScoped: vi.fn(async () => []),
}));

vi.mock("../../src/core/snapshot/a11yTree.js", () => ({
  pruneAxTree: vi.fn(() => []),
  buildFormattedNodes: vi.fn(() => ({})),
}));

vi.mock("../../src/core/snapshot/treeFormatter.js", () => ({
  formatTree: vi.fn(() => {
    const links = site.links.get(currentUrl) ?? [];
    return {
      tree: `tree of ${currentUrl}`,
      urlMap: new Map(links.map((l, i) => [`0-${i}`, l])),
      imageMap: new Map(),
      nodeCount: 1,
    };
  }),
  enrichMapsFromAxNodes: vi.fn(),
  resolveImageSrcsFromDOM: vi.fn(async () => {}),
}));

const downloadImages = vi.fn(async () => new Map<string, string>());
vi.mock("../../src/core/output/imageCollector.js", () => ({
  downloadImages: (...args: unknown[]) => downloadImages(...(args as [])),
}));

const { Megamaid } = await import("../../src/core/megamaid.js");
const { loadCrawlState } = await import("../../src/core/crawlState.js");

const HC = "https://example.com/hc";
const BARE = `${HC}/articles/1`;
const OLD = `${HC}/articles/1-old`;
const TITLE = `${HC}/articles/1-title`;

let outputDir: string;

async function snapshotFiles(): Promise<string[]> {
  return (await readdir(path.join(outputDir, "snapshots"))).sort();
}

async function readSnapshot(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(outputDir, "snapshots", name), "utf-8"));
}

beforeEach(async () => {
  outputDir = await mkdtemp(path.join(tmpdir(), "megamaid-redirects-"));
  site.redirects.clear();
  site.links.clear();
  navigated.length = 0;
  currentUrl = "about:blank";
  downloadImages.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(outputDir, { recursive: true, force: true });
});

describe("crawlAndSnapshot with redirecting URLs", () => {
  it("captures a page once when several URLs redirect to it", async () => {
    // A help centre that redirects bare IDs and stale slugs to the current slug.
    site.links.set(HC, [BARE, OLD, TITLE]);
    site.redirects.set(BARE, TITLE);
    site.redirects.set(OLD, TITLE);

    const mm = new Megamaid({ outputDir });
    const manifest = await mm.crawlAndSnapshot(HC, { match: ["/hc/**"], maxPages: 10 });

    expect(await snapshotFiles()).toEqual(["hc-articles-1-title.json", "hc.json"]);

    const article = await readSnapshot("hc-articles-1-title.json");
    expect(article.url).toBe(TITLE);
    expect(article.requestedUrl).toBe(BARE);

    // The start page did not redirect, so it carries no requestedUrl.
    expect(await readSnapshot("hc.json")).not.toHaveProperty("requestedUrl");

    expect(manifest.pages.map((p) => p.url)).toEqual([HC, TITLE]);
    expect(manifest.pageCount).toBe(2);

    // The canonical URL is never navigated to directly; the old slug is
    // navigated (the redirect can't be known otherwise) but not captured.
    expect(navigated).toEqual([HC, BARE, OLD]);
    expect(downloadImages).toHaveBeenCalledTimes(2);
  });

  it("marks every variant completed in crawl state", async () => {
    site.links.set(HC, [BARE, OLD, TITLE]);
    site.redirects.set(BARE, TITLE);
    site.redirects.set(OLD, TITLE);

    // Stop after the start page + first article so the state file survives.
    const mm = new Megamaid({ outputDir });
    await mm.crawlAndSnapshot(HC, { match: ["/hc/**"], maxPages: 2 });

    const state = await loadCrawlState(outputDir);
    expect(state).not.toBeNull();
    expect(state!.completedUrls).toEqual([HC, BARE, TITLE]);
    expect(state!.queue).toEqual([OLD]);

    // Resume: the old slug is skipped as a duplicate, and the bare ID is not
    // re-queued even though no manifest page carries its URL.
    const resumed = new Megamaid({ outputDir });
    navigated.length = 0;
    const manifest = await resumed.crawlAndSnapshot(HC, { match: ["/hc/**"], resume: true });

    expect(navigated).toEqual([OLD]);
    expect(manifest.pages.map((p) => p.url)).toEqual([HC, TITLE]);
    expect(await snapshotFiles()).toEqual(["hc-articles-1-title.json", "hc.json"]);
    // Crawl finished cleanly, so the state file is removed.
    expect(await loadCrawlState(outputDir)).toBeNull();
  });

  it("records completedUrls for all three variants on a full crawl", async () => {
    site.links.set(HC, [BARE, OLD, TITLE]);
    site.redirects.set(BARE, TITLE);
    site.redirects.set(OLD, TITLE);

    // Force a leftover failed URL so the state file is kept for inspection.
    site.links.set(TITLE, [`${HC}/broken`]);
    const { navigateTo } = await import("../../src/core/browser.js");
    const fake = vi.mocked(navigateTo).getMockImplementation()!;
    vi.mocked(navigateTo).mockImplementation(async (page, url, opts) => {
      if (url === `${HC}/broken`) throw new Error("boom");
      return fake(page, url, opts);
    });

    const mm = new Megamaid({ outputDir });
    await mm.crawlAndSnapshot(HC, { match: ["/hc/**"] });

    const state = await loadCrawlState(outputDir);
    expect(new Set(state!.completedUrls)).toEqual(new Set([HC, BARE, TITLE, OLD]));
    expect(state!.completedUrls.filter((u) => u === TITLE)).toHaveLength(1);
    expect(state!.failedUrls).toEqual([`${HC}/broken`]);
    vi.mocked(navigateTo).mockImplementation(fake);
  });

  it("captures under the canonical URL when discovered later and its link comes up", async () => {
    // The canonical link appears on the captured page itself; it must not be
    // queued again.
    site.links.set(HC, [BARE]);
    site.links.set(TITLE, [TITLE, OLD]);
    site.redirects.set(BARE, TITLE);
    site.redirects.set(OLD, TITLE);

    const mm = new Megamaid({ outputDir });
    const manifest = await mm.crawlAndSnapshot(HC, { match: ["/hc/**"] });

    expect(navigated).toEqual([HC, BARE, OLD]);
    expect(manifest.pages.map((p) => p.url)).toEqual([HC, TITLE]);
  });

  it("keeps logged-out pages under their own URLs when they bounce to sign-in", async () => {
    const A = `${HC}/articles/2-a`;
    const B = `${HC}/articles/3-b`;
    site.links.set(HC, [A, B]);
    site.redirects.set(A, "https://example.com/auth/signin?return_to=%2Fhc%2Farticles%2F2-a");
    site.redirects.set(B, "https://example.com/auth/signin?return_to=%2Fhc%2Farticles%2F3-b");

    const mm = new Megamaid({ outputDir });
    const manifest = await mm.crawlAndSnapshot(HC, { match: ["/hc/**"] });

    expect(await snapshotFiles()).toEqual([
      "hc-articles-2-a.json",
      "hc-articles-3-b.json",
      "hc.json",
    ]);
    expect(await readSnapshot("hc-articles-2-a.json")).toMatchObject({ url: A });
    expect(await readSnapshot("hc-articles-2-a.json")).not.toHaveProperty("requestedUrl");
    expect(manifest.pages.map((p) => p.url)).toEqual([HC, A, B]);
  });
});
