// tests/acceptance/chunking.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { Megamaid } from "../../src/core/megamaid.js";
import { loadSchema } from "../../src/core/schema/loader.js";
import { existsSync, rmSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../.test-output/chunking");

describe("rag-chunking", () => {
  afterAll(() => {
    if (existsSync(OUTPUT_DIR)) {
      rmSync(OUTPUT_DIR, { recursive: true });
    }
  });

  it("chunks a large page into multiple files with YAML frontmatter", async () => {
    const schemaPath = path.join(__dirname, "../fixtures/cortex-doc-page.ts");
    const schema = await loadSchema(schemaPath);

    const megamaid = new Megamaid({
      chunkConfig: { chunkSize: 1500, overlap: 200, splitOnHeadings: true },
    });

    const result = await megamaid.extractMany(
      ["https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-cloud-introduction"],
      { schema, outputDir: OUTPUT_DIR }
    );

    expect(result.pages.length).toBe(1);

    // Full page should exist
    const mdFiles = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".md") && f !== "index.md");
    expect(mdFiles.length).toBeGreaterThanOrEqual(1);

    // Chunks directory should exist with multiple chunk files
    const chunksDir = path.join(OUTPUT_DIR, "chunks");
    expect(existsSync(chunksDir)).toBe(true);

    const chunkFiles = readdirSync(chunksDir).filter((f) => f.endsWith(".md"));
    expect(chunkFiles.length).toBeGreaterThan(1);

    // Each chunk should have YAML frontmatter
    for (const file of chunkFiles.slice(0, 3)) {
      const content = readFileSync(path.join(chunksDir, file), "utf-8");
      expect(content).toMatch(/^---\n/);
      expect(content).toContain("source_url:");
      expect(content).toContain("source_title:");
      expect(content).toContain("chunk:");
      expect(content).toContain("heading_context:");
    }

    // Manifest should exist
    const manifestPath = path.join(OUTPUT_DIR, "chunks-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.totalChunks).toBeGreaterThan(1);
    expect(manifest.pages.length).toBe(1);
  }, 600_000);
});
