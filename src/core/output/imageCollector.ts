// src/core/output/imageCollector.ts
import { writeFile, mkdir } from "fs/promises";
import path from "path";

/**
 * Default minimum image dimension in pixels. Images where both width
 * and height are below this are considered icons/spacers and skipped.
 */
export const DEFAULT_MIN_IMAGE_DIM = 150; // 150px

/**
 * Default minimum image size in bytes. Images below this are skipped.
 * Set to 0 to disable byte-size filtering (rely on dimensions only).
 */
export const DEFAULT_MIN_IMAGE_SIZE = 0;

/** Normalized result of fetching an image, independent of the HTTP client used. */
export interface ImageFetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: Buffer;
}

/**
 * Fetches an image by URL. Injected so callers can route downloads through an
 * authenticated browser context (carrying session cookies) instead of a bare,
 * cookieless fetch. Defaults to {@link defaultImageFetcher}.
 */
export type ImageFetcher = (url: string) => Promise<ImageFetchResult>;

/** Bare global-fetch fetcher. Carries no cookies — only works for public images. */
export const defaultImageFetcher: ImageFetcher = async (url) => {
  const response = await fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: Buffer.from(await response.arrayBuffer()),
  };
};

export async function downloadImages(
  imageMap: Map<string, string>,
  outputDir: string,
  pageName: string,
  options: {
    minImageSize?: number;
    minImageDim?: number;
    skipSvg?: boolean;
    fetcher?: ImageFetcher;
  } = {}
): Promise<Map<string, string>> {
  const minImageSize = options.minImageSize ?? DEFAULT_MIN_IMAGE_SIZE;
  const minImageDim = options.minImageDim ?? DEFAULT_MIN_IMAGE_DIM;
  const skipSvg = options.skipSvg ?? false;
  const fetcher = options.fetcher ?? defaultImageFetcher;
  const imageDir = path.join(outputDir, "images", pageName);
  await mkdir(imageDir, { recursive: true });

  const pathMap = new Map<string, string>();
  let counter = 1;
  let skippedSize = 0;
  let skippedDim = 0;
  let skippedSvg = 0;
  let failed = 0;

  for (const [, imageUrl] of imageMap) {
    try {
      const response = await fetcher(imageUrl);
      if (!response.ok) {
        failed++;
        if (process.env.MEGAMAID_DEBUG) {
          console.error(`[images] Download failed (${response.status}): ${imageUrl}`);
        }
        continue;
      }

      const buffer = response.body;

      // Skip SVGs entirely when requested (theme icons/logos are usually SVG)
      if (skipSvg && (response.contentType.includes("svg") || /\.svg(\?|#|$)/i.test(imageUrl))) {
        skippedSvg++;
        continue;
      }

      // Skip images below the minimum byte size threshold
      if (minImageSize > 0 && buffer.length < minImageSize) {
        skippedSize++;
        continue;
      }

      // Skip images below the minimum pixel dimension threshold
      if (minImageDim > 0) {
        const dims = getImageDimensions(buffer);
        if (dims && dims.width < minImageDim && dims.height < minImageDim) {
          skippedDim++;
          continue;
        }
      }

      const ext = getExtension(response.contentType, imageUrl);
      const filename = `img-${String(counter).padStart(3, "0")}${ext}`;
      const localPath = path.join("images", pageName, filename);
      const fullPath = path.join(outputDir, localPath);

      await writeFile(fullPath, buffer);

      pathMap.set(imageUrl, localPath);
      counter++;
    } catch (err) {
      failed++;
      if (process.env.MEGAMAID_DEBUG) {
        console.error(`[images] Download error for ${imageUrl}: ${(err as Error).message}`);
      }
    }
  }

  if ((skippedSize > 0 || skippedDim > 0 || skippedSvg > 0 || failed > 0) && process.env.MEGAMAID_DEBUG) {
    if (failed > 0) console.error(`[images] ${failed} image download(s) failed`);
    if (skippedSvg > 0) console.error(`[images] Skipped ${skippedSvg} SVG images`);
    if (skippedSize > 0) console.error(`[images] Skipped ${skippedSize} images below ${minImageSize}B`);
    if (skippedDim > 0) console.error(`[images] Skipped ${skippedDim} images below ${minImageDim}x${minImageDim}px`);
  }

  return pathMap;
}

/**
 * Parse image dimensions from binary header. Supports PNG, JPEG, GIF, WebP, SVG.
 * Returns null if format is unrecognized, truncated, or the size is undeclared.
 */
export function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 10) return null;

  // SVG: text-based. Read width/height attrs (px/unitless) or fall back to
  // viewBox. Without this, SVGs return null and bypass the dimension filter,
  // so every tiny theme icon gets saved.
  const head = buffer.subarray(0, 2048).toString("utf8");
  const svgStart = head.indexOf("<svg");
  if (svgStart !== -1) {
    const tagEnd = head.indexOf(">", svgStart);
    const tag = head.slice(svgStart, tagEnd === -1 ? undefined : tagEnd);
    const attr = (name: string): number | null => {
      const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
      if (!m) return null;
      const px = m[1].trim().match(/^([\d.]+)(px)?$/i); // reject %, em, etc.
      return px ? Math.round(parseFloat(px[1])) : null;
    };
    let width = attr("width");
    let height = attr("height");
    if (width === null || height === null) {
      const vb = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
      if (vb) {
        const parts = vb[1].trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
          if (width === null) width = Math.round(parts[2]);
          if (height === null) height = Math.round(parts[3]);
        }
      }
    }
    if (width !== null && height !== null) return { width, height };
    return null;
  }

  // PNG: bytes 16-23 contain width and height as big-endian uint32
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // GIF: bytes 6-9 contain width and height as little-endian uint16
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }

  // WebP: RIFF header, then "WEBP", then chunk type
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8 " && buffer.length >= 30) {
      // Lossy: dimensions at bytes 26-29
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && buffer.length >= 25) {
      // Lossless: packed into bytes 21-24
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
  }

  // JPEG: scan for SOF0/SOF2 markers (0xFF 0xC0 or 0xFF 0xC2)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      // Skip to next marker
      const segLen = buffer.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  }

  return null;
}

export function replaceImageRefsInMarkdown(
  markdown: string,
  imagePathMap: Map<string, string>
): string {
  // Build a reverse lookup: filename/path suffix → local path
  // This handles cases where the Markdown has relative URLs that don't
  // exactly match the absolute URLs used as keys in imagePathMap
  const suffixMap = new Map<string, string>();
  for (const [url, localPath] of imagePathMap) {
    suffixMap.set(url, localPath);
    // Also index by the URL's pathname
    try {
      const parsed = new URL(url);
      suffixMap.set(parsed.pathname, localPath);
      // And by the last path segments (e.g., "media/intro/img.png")
      const parts = parsed.pathname.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        suffixMap.set(parts.slice(i).join("/"), localPath);
      }
    } catch {
      // Not a valid URL, skip
    }
  }

  // Match Markdown image syntax: ![alt](url)
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => {
      // Try exact match first
      let localPath = suffixMap.get(url);
      if (localPath) return `![${alt}](${localPath})`;

      // Try matching by stripping query params and fragments
      const cleanUrl = url.split("?")[0].split("#")[0];
      localPath = suffixMap.get(cleanUrl);
      if (localPath) return `![${alt}](${localPath})`;

      return match;
    }
  );
}

function getExtension(contentType: string, url: string): string {
  const ctMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
  };

  for (const [ct, ext] of Object.entries(ctMap)) {
    if (contentType.includes(ct)) return ext;
  }

  // Fallback: extract from URL
  const urlExt = url.match(/\.(jpe?g|png|gif|webp|svg)(\?|$)/i);
  if (urlExt) return `.${urlExt[1].toLowerCase()}`;

  return ".jpg"; // default
}
