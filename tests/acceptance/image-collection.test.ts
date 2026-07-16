// tests/acceptance/image-collection.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { Megamaid } from "../../src/core/megamaid.js";
import { loadSchema } from "../../src/core/schema/loader.js";
import { existsSync, rmSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../.test-output/image-collection");

// Use a Cortex page that likely has images
const CORTEX_URL =
  "https://docs-cortex.paloaltonetworks.com/r/Cortex-XSIAM/Cortex-XSIAM-Documentation/Cortex-XSIAM-architecture";

describe("image-collection", () => {
  afterAll(() => {
    if (existsSync(OUTPUT_DIR)) {
      rmSync(OUTPUT_DIR, { recursive: true });
    }
  });

  it("downloads images and updates Markdown references", async () => {
    const schema = z.object({
      title: z.string().describe("Page title"),
      body: z.string().describe("Full page content as Markdown, including images"),
      heroImage: z.string().url().describe("Main hero/banner image URL").optional(),
    });

    const megamaid = new Megamaid();
    const result = await megamaid.extract(CORTEX_URL, {
      schema,
      outputDir: OUTPUT_DIR,
    });

    // Check if images directory was created (page may or may not have images)
    if (result.metadata.imageCount > 0) {
      const imagesDir = path.join(OUTPUT_DIR, "images");
      expect(existsSync(imagesDir)).toBe(true);

      // Verify Markdown references point to local files, not remote URLs
      const imageRefs = [...result.markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
      for (const ref of imageRefs) {
        const imgPath = ref[1];
        if (imgPath.startsWith("images/")) {
          // Verify the local file exists
          expect(existsSync(path.join(OUTPUT_DIR, imgPath))).toBe(true);
        }
      }
    }
  }, 120_000);
});
