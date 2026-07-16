// tests/acceptance/crawl-mode.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { Megamaid } from "../../src/core/megamaid.js";
import { existsSync, rmSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../.test-output/crawl-mode");

const CORTEX_START_URL =
  "https://docs-cortex.paloaltonetworks.com/r/Cortex-XSIAM/Cortex-XSIAM-Documentation/Get-started-with-Cortex-XSIAM";

describe("crawl-mode", () => {
  afterAll(() => {
    if (existsSync(OUTPUT_DIR)) {
      rmSync(OUTPUT_DIR, { recursive: true });
    }
  });

  it("discovers and snapshots pages in a single pass", async () => {
    const megamaid = new Megamaid();

    const manifest = await megamaid.crawlAndSnapshot(CORTEX_START_URL, {
      match: "/r/Cortex-XSIAM/**",
      maxPages: 5,
      outputDir: OUTPUT_DIR,
    });

    expect(manifest.pageCount).toBeGreaterThanOrEqual(2);
    expect(manifest.pageCount).toBeLessThanOrEqual(5);

    // All pages should be from the same site
    for (const page of manifest.pages) {
      expect(page.url).toContain("docs-cortex.paloaltonetworks.com");
    }

    // All should match the pattern
    for (const page of manifest.pages) {
      expect(new URL(page.url).pathname).toMatch(/^\/r\/Cortex-XSIAM\//);
    }

    // Snapshots should exist on disk
    for (const page of manifest.pages) {
      const snapshotPath = path.join(OUTPUT_DIR, page.snapshot);
      expect(existsSync(snapshotPath)).toBe(true);
    }
  }, 180_000);
});
