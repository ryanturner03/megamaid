// tests/unit/crawlState.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { saveCrawlState, loadCrawlState, detectInterruptedCrawl } from "../../src/core/crawlState.js";
import type { CrawlState } from "../../src/types/index.js";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "megamaid-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true });
});

const sampleState: CrawlState = {
  version: 1,
  startUrl: "https://example.com/docs",
  match: "/docs/**",
  discoveredUrls: ["https://example.com/docs", "https://example.com/docs/page-1", "https://example.com/docs/page-2"],
  completedUrls: ["https://example.com/docs"],
  failedUrls: [],
  queue: ["https://example.com/docs/page-1", "https://example.com/docs/page-2"],
  startedAt: "2026-03-27T10:00:00Z",
  updatedAt: "2026-03-27T10:01:00Z",
  config: { selector: undefined, siteConfig: undefined, session: undefined },
};

describe("saveCrawlState", () => {
  it("writes state to .megamaid-state.json in the given directory", async () => {
    await saveCrawlState(sampleState, tempDir);

    const content = await readFile(path.join(tempDir, ".megamaid-state.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(1);
    expect(parsed.completedUrls).toEqual(["https://example.com/docs"]);
    expect(parsed.queue).toHaveLength(2);
  });

  it("overwrites existing state file atomically", async () => {
    await saveCrawlState(sampleState, tempDir);

    const updated = { ...sampleState, completedUrls: ["https://example.com/docs", "https://example.com/docs/page-1"], queue: ["https://example.com/docs/page-2"], updatedAt: "2026-03-27T10:02:00Z" };
    await saveCrawlState(updated, tempDir);

    const content = await readFile(path.join(tempDir, ".megamaid-state.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.completedUrls).toHaveLength(2);
    expect(parsed.queue).toHaveLength(1);
  });
});

describe("loadCrawlState", () => {
  it("returns state from existing file", async () => {
    await saveCrawlState(sampleState, tempDir);
    const loaded = await loadCrawlState(tempDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.startUrl).toBe("https://example.com/docs");
    expect(loaded!.queue).toHaveLength(2);
  });

  it("returns null when no state file exists", async () => {
    const loaded = await loadCrawlState(tempDir);
    expect(loaded).toBeNull();
  });

  it("returns null for corrupted state file", async () => {
    await writeFile(path.join(tempDir, ".megamaid-state.json"), "not valid json", "utf-8");
    const loaded = await loadCrawlState(tempDir);
    expect(loaded).toBeNull();
  });
});

describe("detectInterruptedCrawl", () => {
  it("detects an interrupted crawl with correct info", async () => {
    await saveCrawlState(sampleState, tempDir);
    const result = await detectInterruptedCrawl(tempDir);

    expect(result.found).toBe(true);
    expect(result.info!.pagesCompleted).toBe(1);
    expect(result.info!.pagesRemaining).toBe(2);
    expect(result.info!.startUrl).toBe("https://example.com/docs");
  });

  it("returns found=false when no state file", async () => {
    const result = await detectInterruptedCrawl(tempDir);
    expect(result.found).toBe(false);
  });
});
