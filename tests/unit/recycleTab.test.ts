// tests/unit/recycleTab.test.ts
//
// Drives Megamaid.crawlAndSnapshot against a fake browser to check that
// recycleTabEvery swaps to a fresh tab in the same context every N page loads.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

// Each fake tab records the URLs it loaded; the context hands out new tabs.
interface FakeTab {
  id: number;
  loaded: string[];
  closed: boolean;
  url: () => string;
  title: () => Promise<string>;
  close: () => Promise<void>;
  context: () => typeof context;
}
const tabs: FakeTab[] = [];
let managed = true;

function newTab(): FakeTab {
  const tab: FakeTab = {
    id: tabs.length,
    loaded: [],
    closed: false,
    url: () => tab.loaded.at(-1) ?? "about:blank",
    title: async () => `Title of ${tab.url()}`,
    close: async () => { tab.closed = true; },
    context: () => context,
  };
  tabs.push(tab);
  return tab;
}
const context = { newPage: vi.fn(async () => newTab()) };

vi.mock("../../src/core/browser.js", () => ({
  connectBrowser: vi.fn(async () => ({ page: newTab(), isManaged: managed })),
  navigateTo: vi.fn(async (page: FakeTab, url: string) => {
    if (page.closed) throw new Error("navigated a closed tab");
    page.loaded.push(url);
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

const ROOT = "https://example.com/docs";
const PAGES = [1, 2, 3, 4, 5].map((n) => `${ROOT}/p${n}`);

vi.mock("../../src/core/snapshot/treeFormatter.js", () => ({
  // The start page links to every other page; the others link nowhere.
  formatTree: vi.fn((_nodes: unknown, _opts: unknown) => ({
    tree: "tree",
    urlMap: new Map(tabs.at(-1)!.url() === ROOT ? PAGES.map((l, i) => [`0-${i}`, l]) : []),
    imageMap: new Map(),
    nodeCount: 1,
  })),
  enrichMapsFromAxNodes: vi.fn(),
  resolveImageSrcsFromDOM: vi.fn(async () => {}),
}));

vi.mock("../../src/core/output/imageCollector.js", () => ({
  downloadImages: vi.fn(async () => new Map<string, string>()),
}));

const { Megamaid } = await import("../../src/core/megamaid.js");

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(path.join(tmpdir(), "megamaid-recycle-"));
  tabs.length = 0;
  managed = true;
  context.newPage.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(outputDir, { recursive: true, force: true });
});

describe("recycleTabEvery", () => {
  it("opens a fresh tab every N page loads and closes the old one", async () => {
    const mm = new Megamaid({ outputDir, recycleTabEvery: 2 });
    const manifest = await mm.crawlAndSnapshot(ROOT, { match: ["/docs/**"] });

    expect(tabs.map((t) => t.loaded)).toEqual([
      [ROOT, PAGES[0]],
      [PAGES[1], PAGES[2]],
      [PAGES[3], PAGES[4]],
    ]);
    expect(tabs.map((t) => t.closed)).toEqual([true, true, false]);
    expect(manifest.pageCount).toBe(6);
  });

  it("keeps one tab when unset", async () => {
    const mm = new Megamaid({ outputDir });
    await mm.crawlAndSnapshot(ROOT, { match: ["/docs/**"] });

    expect(tabs).toHaveLength(1);
    expect(tabs[0].loaded).toEqual([ROOT, ...PAGES]);
    expect(context.newPage).not.toHaveBeenCalled();
  });

  it("never swaps the tab of a browser it attached to over CDP", async () => {
    managed = false;
    const mm = new Megamaid({ outputDir, recycleTabEvery: 2 });
    await mm.crawlAndSnapshot(ROOT, { match: ["/docs/**"] });

    expect(tabs).toHaveLength(1);
    expect(tabs[0].closed).toBe(false);
  });

  it("recycles in URL-list mode too", async () => {
    const mm = new Megamaid({ outputDir, recycleTabEvery: 3 });
    await mm.snapshotMany(PAGES, { outputDir });

    expect(tabs.map((t) => t.loaded)).toEqual([PAGES.slice(0, 3), PAGES.slice(3)]);
  });
});
