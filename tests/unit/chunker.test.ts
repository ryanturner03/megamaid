// tests/unit/chunker.test.ts
import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../../src/core/output/chunker.js";
import type { ChunkConfig } from "../../src/types/index.js";

const sampleMarkdown = `# Getting Started

Welcome to the product.

## Installation

Run the following command to install:

\`\`\`bash
npm install my-tool
\`\`\`

After installation, verify it works.

## Configuration

### Environment Variables

Set the following variables:

- \`API_KEY\`: Your API key
- \`BASE_URL\`: The base URL

### Config File

Create a config.json with your settings.

## Usage

Run \`my-tool extract\` to begin.

### Basic Usage

Just pass a URL and a schema.

### Advanced Usage

You can use site configs for multi-schema routing.
`;

const defaultConfig: ChunkConfig = {
  chunkSize: 300,
  overlap: 50,
  splitOnHeadings: true,
};

describe("chunkMarkdown", () => {
  it("splits markdown at heading boundaries", () => {
    const chunks = chunkMarkdown(sampleMarkdown, defaultConfig);
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should be under chunkSize (with some tolerance)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(defaultConfig.chunkSize * 1.5);
    }
  });

  it("assigns sequential indices starting at 0", () => {
    const chunks = chunkMarkdown(sampleMarkdown, defaultConfig);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it("tracks heading context for each chunk", () => {
    const chunks = chunkMarkdown(sampleMarkdown, defaultConfig);

    // First chunk should have the top-level heading context
    expect(chunks[0].headingContext).toContain("Getting Started");

    // Later chunks should have their section context
    const configChunk = chunks.find((c) => c.text.includes("Environment Variables"));
    expect(configChunk).toBeDefined();
    expect(configChunk!.headingContext).toContain("Configuration");
  });

  it("preserves all content — no text lost between chunks", () => {
    const chunks = chunkMarkdown(sampleMarkdown, defaultConfig);

    // Every non-whitespace line from the original should appear in at least one chunk
    const originalLines = sampleMarkdown.split("\n").filter((l) => l.trim().length > 10);
    for (const line of originalLines) {
      const found = chunks.some((c) => c.text.includes(line.trim()));
      expect(found, `Missing line: "${line.trim()}"`).toBe(true);
    }
  });

  it("returns single chunk for small content", () => {
    const small = "# Title\n\nShort content.";
    const chunks = chunkMarkdown(small, { chunkSize: 1500, overlap: 200, splitOnHeadings: true });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("Short content.");
  });

  it("falls back to character splitting for oversized sections", () => {
    const longSection = "# Title\n\n" + "Word ".repeat(500); // ~2500 chars, no sub-headings
    const chunks = chunkMarkdown(longSection, { chunkSize: 500, overlap: 50, splitOnHeadings: true });
    expect(chunks.length).toBeGreaterThan(1);
  });
});
