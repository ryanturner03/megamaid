// tests/unit/imageCollector.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  replaceImageRefsInMarkdown,
  getImageDimensions,
  downloadImages,
  type ImageFetcher,
} from "../../src/core/output/imageCollector.js";

/** Build a minimal valid PNG buffer of the given dimensions. */
function pngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** A fetcher backed by an in-memory url -> {png bytes} table. */
function fetcherFor(
  table: Record<string, { width: number; height: number } | { status: number }>
): ImageFetcher {
  return async (url: string) => {
    const entry = table[url];
    if (!entry || "status" in entry) {
      return { ok: false, status: entry ? entry.status : 404, contentType: "", body: Buffer.alloc(0) };
    }
    const body = pngBuffer(entry.width, entry.height);
    return { ok: true, status: 200, contentType: "image/png", body };
  };
}

describe("replaceImageRefsInMarkdown", () => {
  it("replaces image URLs with local paths", () => {
    const markdown = `# Title\n\n![Hero image](https://example.com/hero.jpg)\n\nSome text.\n\n![Diagram](https://example.com/diagram.png)`;
    const imagePathMap = new Map([
      ["https://example.com/hero.jpg", "images/page-1/img-001.jpg"],
      ["https://example.com/diagram.png", "images/page-1/img-002.png"],
    ]);

    const result = replaceImageRefsInMarkdown(markdown, imagePathMap);

    expect(result).toContain("![Hero image](images/page-1/img-001.jpg)");
    expect(result).toContain("![Diagram](images/page-1/img-002.png)");
    expect(result).not.toContain("https://example.com");
  });

  it("leaves non-image links unchanged", () => {
    const markdown = `[Click here](https://example.com/page)`;
    const imagePathMap = new Map<string, string>();

    const result = replaceImageRefsInMarkdown(markdown, imagePathMap);

    expect(result).toContain("[Click here](https://example.com/page)");
  });
});

describe("getImageDimensions", () => {
  it("parses PNG dimensions", () => {
    // Minimal valid PNG header: 8-byte signature + IHDR chunk (13 bytes data)
    const buf = Buffer.alloc(24);
    // PNG signature
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    // IHDR chunk length (13)
    buf.writeUInt32BE(13, 8);
    // "IHDR"
    buf.write("IHDR", 12);
    // Width = 800, Height = 600
    buf.writeUInt32BE(800, 16);
    buf.writeUInt32BE(600, 20);

    const dims = getImageDimensions(buf);
    expect(dims).toEqual({ width: 800, height: 600 });
  });

  it("parses GIF dimensions", () => {
    const buf = Buffer.alloc(10);
    buf.write("GIF89a", 0);
    buf.writeUInt16LE(320, 6);
    buf.writeUInt16LE(240, 8);

    const dims = getImageDimensions(buf);
    expect(dims).toEqual({ width: 320, height: 240 });
  });

  it("returns null for unrecognized format", () => {
    const buf = Buffer.from("not an image");
    expect(getImageDimensions(buf)).toBeNull();
  });

  it("parses SVG width/height attributes in px", () => {
    const buf = Buffer.from(`<svg width="24px" height="24px" xmlns="http://www.w3.org/2000/svg"></svg>`);
    expect(getImageDimensions(buf)).toEqual({ width: 24, height: 24 });
  });

  it("parses unitless SVG width/height", () => {
    const buf = Buffer.from(`<svg width="110" height="24" viewBox="0 0 110 24"></svg>`);
    expect(getImageDimensions(buf)).toEqual({ width: 110, height: 24 });
  });

  it("falls back to viewBox when width/height are percentages", () => {
    const buf = Buffer.from(`<svg width="100%" height="100%" viewBox="0 0 640 480"></svg>`);
    expect(getImageDimensions(buf)).toEqual({ width: 640, height: 480 });
  });

  it("falls back to viewBox when width/height are absent", () => {
    const buf = Buffer.from(`<?xml version="1.0"?>\n<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"></svg>`);
    expect(getImageDimensions(buf)).toEqual({ width: 16, height: 16 });
  });

  it("returns null for an SVG with no determinable size", () => {
    const buf = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
    expect(getImageDimensions(buf)).toBeNull();
  });

  it("returns null for truncated buffer", () => {
    const buf = Buffer.alloc(10);
    expect(getImageDimensions(buf)).toBeNull();
  });
});

describe("downloadImages", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), "megamaid-images-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("downloads images through the provided fetcher and writes files", async () => {
    const url = "https://auth.example.com/private/diagram.png";
    const fetcher = fetcherFor({ [url]: { width: 800, height: 600 } });
    const imageMap = new Map([["0-1", url]]);

    const result = await downloadImages(imageMap, outDir, "page", { fetcher });

    const localPath = result.get(url);
    expect(localPath).toBe(path.join("images", "page", "img-001.png"));
    const written = await readFile(path.join(outDir, localPath!));
    expect(getImageDimensions(written)).toEqual({ width: 800, height: 600 });
  });

  it("skips images the fetcher reports as not-ok (e.g. auth failure)", async () => {
    const ok = "https://auth.example.com/ok.png";
    const denied = "https://auth.example.com/denied.png";
    const fetcher = fetcherFor({ [ok]: { width: 400, height: 400 }, [denied]: { status: 403 } });
    const imageMap = new Map([
      ["0-1", denied],
      ["0-2", ok],
    ]);

    const result = await downloadImages(imageMap, outDir, "page", { fetcher });

    expect(result.has(denied)).toBe(false);
    // The surviving image keeps a stable img-001 name despite the earlier failure.
    expect(result.get(ok)).toBe(path.join("images", "page", "img-001.png"));
  });

  it("logs failed downloads under MEGAMAID_DEBUG", async () => {
    const prev = process.env.MEGAMAID_DEBUG;
    process.env.MEGAMAID_DEBUG = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const denied = "https://auth.example.com/denied.png";
      const fetcher = fetcherFor({ [denied]: { status: 403 } });
      await downloadImages(new Map([["0-1", denied]]), outDir, "page", { fetcher });
      const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toMatch(/1 image/i);
      expect(logged).toMatch(/fail/i);
    } finally {
      if (prev === undefined) delete process.env.MEGAMAID_DEBUG;
      else process.env.MEGAMAID_DEBUG = prev;
    }
  });

  it("applies the minImageDim filter to small SVG icons", async () => {
    const icon = "https://auth.example.com/icon.svg";
    const fetcher: ImageFetcher = async () => ({
      ok: true,
      status: 200,
      contentType: "image/svg+xml",
      body: Buffer.from(`<svg width="24" height="24" viewBox="0 0 24 24"></svg>`),
    });

    const result = await downloadImages(new Map([["0-1", icon]]), outDir, "page", {
      fetcher,
      minImageDim: 150,
    });

    expect(result.has(icon)).toBe(false);
  });

  it("keeps large SVGs above the dimension threshold", async () => {
    const art = "https://auth.example.com/diagram.svg";
    const fetcher: ImageFetcher = async () => ({
      ok: true,
      status: 200,
      contentType: "image/svg+xml",
      body: Buffer.from(`<svg width="640" height="480" viewBox="0 0 640 480"></svg>`),
    });

    const result = await downloadImages(new Map([["0-1", art]]), outDir, "page", {
      fetcher,
      minImageDim: 150,
    });

    expect(result.get(art)).toBe(path.join("images", "page", "img-001.svg"));
  });

  it("skips all SVGs when skipSvg is set, regardless of size", async () => {
    const bigSvg = "https://auth.example.com/diagram.svg";
    const png = "https://auth.example.com/shot.png";
    const fetcher: ImageFetcher = async (url) =>
      url.endsWith(".svg")
        ? { ok: true, status: 200, contentType: "image/svg+xml", body: Buffer.from(`<svg width="640" height="480"></svg>`) }
        : { ok: true, status: 200, contentType: "image/png", body: pngBuffer(640, 480) };

    const result = await downloadImages(new Map([["0-1", bigSvg], ["0-2", png]]), outDir, "page", {
      fetcher,
      skipSvg: true,
    });

    expect(result.has(bigSvg)).toBe(false);
    expect(result.get(png)).toBe(path.join("images", "page", "img-001.png"));
  });

  it("applies the minImageDim filter (both dims below threshold)", async () => {
    const icon = "https://auth.example.com/icon.png";
    const fetcher = fetcherFor({ [icon]: { width: 24, height: 24 } });

    const result = await downloadImages(new Map([["0-1", icon]]), outDir, "page", {
      fetcher,
      minImageDim: 150,
    });

    expect(result.has(icon)).toBe(false);
  });
});
