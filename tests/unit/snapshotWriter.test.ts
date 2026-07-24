import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeSnapshot, writeSiteManifest, loadSiteManifest } from "../../src/core/snapshotWriter.js";
import type { SnapshotFile, SiteManifest } from "../../src/types/index.js";
import { mkdtemp, rm, readFile, readdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "megamaid-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true });
});

const sampleSnapshot: SnapshotFile = {
  version: 1,
  url: "https://docs.example.com/getting-started",
  title: "Getting Started",
  tree: '[0-1] document: "Getting Started"\n  [0-5] heading level=1: "Getting Started"',
  urlMap: { "0-12": "https://docs.example.com/install" },
  imageMap: { "0-45": "https://docs.example.com/img/hero.png" },
  nodeCount: 42,
  capturedAt: "2026-04-03T12:00:00.000Z",
};

describe("writeSnapshot filename derivation", () => {
  // Query-addressed portals put the page identity
  // entirely in the query string: /s/document-item?bundleId=X&topicId=Y. Naming
  // files from the pathname alone made every document overwrite the same
  // s-document-item.json — a 5-page crawl left 2 files on disk.
  it("gives URLs differing only in query distinct filenames", async () => {
    const base = "https://help.example.com/s/document-item";
    const a = await writeSnapshot(
      { ...sampleSnapshot, url: `${base}?bundleId=uml165&topicId=fcb165.html` },
      tempDir
    );
    const b = await writeSnapshot(
      { ...sampleSnapshot, url: `${base}?bundleId=nmc164&topicId=ksr164.html` },
      tempDir
    );
    expect(a).not.toBe(b);
    expect(await readdir(path.join(tempDir, "snapshots"))).toHaveLength(2);
  });

  it("is deterministic for the same URL", async () => {
    const url = "https://help.example.com/s/csh?context=afb410";
    const a = await writeSnapshot({ ...sampleSnapshot, url }, tempDir);
    const b = await writeSnapshot({ ...sampleSnapshot, url }, tempDir);
    expect(a).toBe(b);
    expect(await readdir(path.join(tempDir, "snapshots"))).toHaveLength(1);
  });

  it("leaves path-only URLs named exactly as before", async () => {
    // Existing corpora on disk depend on these names — no churn allowed.
    const rel = await writeSnapshot(
      { ...sampleSnapshot, url: "https://docs.example.com/r/en-US/x8e31f38/u136a4e9" },
      tempDir
    );
    expect(rel).toBe(path.join("snapshots", "r-en-US-x8e31f38-u136a4e9.json"));
  });
});

describe("writeSnapshot", () => {
  it("writes a snapshot JSON file to snapshots/ directory", async () => {
    const filename = await writeSnapshot(sampleSnapshot, tempDir);
    expect(filename).toBe("snapshots/getting-started.json");
    const content = JSON.parse(await readFile(path.join(tempDir, filename), "utf-8"));
    expect(content.version).toBe(1);
    expect(content.url).toBe("https://docs.example.com/getting-started");
    expect(content.tree).toContain("Getting Started");
    expect(content.urlMap["0-12"]).toBe("https://docs.example.com/install");
  });

  it("handles root URL by using hostname as filename", async () => {
    const rootSnapshot = { ...sampleSnapshot, url: "https://docs.example.com/" };
    const filename = await writeSnapshot(rootSnapshot, tempDir);
    expect(filename).toBe("snapshots/docs-example-com.json");
  });

  it("truncates long URL paths in filenames", async () => {
    const longUrl = "https://example.com/" + "a".repeat(100);
    const snapshot = { ...sampleSnapshot, url: longUrl };
    const filename = await writeSnapshot(snapshot, tempDir);
    const basename = path.basename(filename, ".json");
    expect(basename.length).toBeLessThanOrEqual(80);
  });
});

describe("writeSiteManifest / loadSiteManifest", () => {
  it("writes and reads a site.json manifest", async () => {
    const manifest: SiteManifest = {
      version: 1,
      startUrl: "https://docs.example.com",
      match: "/docs/**",
      pageCount: 1,
      totalImages: 1,
      startedAt: "2026-04-03T12:00:00.000Z",
      pages: [{ url: "https://docs.example.com/getting-started", snapshot: "snapshots/getting-started.json", imageCount: 1 }],
    };
    await writeSiteManifest(manifest, tempDir);
    const loaded = await loadSiteManifest(tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.pageCount).toBe(1);
    expect(loaded!.pages).toHaveLength(1);
  });

  it("returns null when no site.json exists", async () => {
    const loaded = await loadSiteManifest(tempDir);
    expect(loaded).toBeNull();
  });
});
