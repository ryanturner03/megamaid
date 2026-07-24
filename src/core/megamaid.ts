// src/core/megamaid.ts
import { connectBrowser, navigateTo, closeBrowser, humanDelay, dismissCookieBanners, type BrowserConnection, type CookieParam } from "./browser.js";
import { captureAxTree, captureAxTreeScoped } from "./snapshot/capture.js";
import { pruneAxTree, buildFormattedNodes } from "./snapshot/a11yTree.js";
import { formatTree, enrichMapsFromAxNodes, resolveImageSrcsFromDOM } from "./snapshot/treeFormatter.js";
import { downloadImages, type ImageFetcher } from "./output/imageCollector.js";
import type { Page } from "playwright";
import { saveCrawlState, loadCrawlState, deleteCrawlState } from "./crawlState.js";
import { writeSnapshot, writeSiteManifest, loadSiteManifest } from "./snapshotWriter.js";
import { executePreActions } from "./preActions.js";
import { extractLinks, matchesPattern } from "./crawler.js";
import { urlToPageName } from "./urlToPageName.js";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type {
  SnapshotFile,
  SiteManifest,
  SiteManifestPage,
  CrawlState,
  PreAction,
} from "../types/index.js";

export interface MegamaidOptions {
  cdpUrl?: string;
  outputDir?: string;
  concurrency?: number;
  sessionPath?: string;
  preActions?: PreAction[];
  startUrl?: string;
  headed?: boolean;
  proxy?: string;
  selector?: string;
  minImageSize?: number;
  minImageDim?: number;
  skipSvg?: boolean;
  cookies?: CookieParam[];
  excludePatterns?: string[];
}

export interface SnapshotPageResult {
  snapshotFile: SnapshotFile;
  snapshotPath: string;
  imageCount: number;
}

export class Megamaid {
  private options: MegamaidOptions;
  private connection: BrowserConnection | null = null;
  private sessionEstablished = false;

  constructor(options: MegamaidOptions = {}) {
    this.options = {
      outputDir: "./output",
      concurrency: 3,
      ...options,
    };
  }

  async connect(): Promise<void> {
    this.connection = await connectBrowser({
      cdpUrl: this.options.cdpUrl,
      sessionPath: this.options.sessionPath,
      headless: this.options.headed ? false : undefined,
      cookies: this.options.cookies,
    });
  }

  /**
   * Ensure we have a browser connection with preActions already completed.
   * Reuses existing connection if available.
   */
  async ensureSession(): Promise<BrowserConnection> {
    if (!this.connection) {
      await this.connect();
    }

    if (!this.sessionEstablished && (this.options.preActions?.length || this.options.startUrl)) {
      console.log(`  [session] establishing session...`);
      await executePreActions(this.connection!.page, this.options.preActions ?? [], { startUrl: this.options.startUrl });
      this.sessionEstablished = true;
    }

    return this.connection!;
  }

  async close(): Promise<void> {
    if (this.connection) {
      await closeBrowser(this.connection);
      this.connection = null;
      this.sessionEstablished = false;
    }
  }

  /**
   * Capture an AX tree snapshot for a single page, download images, and write
   * the snapshot JSON to disk. Returns the snapshot file, its path, and image count.
   */
  async snapshot(
    url: string,
    options: {
      outputDir?: string;
      selector?: string;
      minImageSize?: number;
      referrer?: string;
    } = {}
  ): Promise<SnapshotPageResult> {
    const outputDir = options.outputDir ?? this.options.outputDir ?? "./output";
    const selector = options.selector ?? this.options.selector;
    const minImageSize = options.minImageSize ?? this.options.minImageSize;

    // Get browser with session established (reuses existing connection)
    const conn = await this.ensureSession();

    // Navigate to the target page
    console.log(`  [snapshot] navigating to ${url}`);
    await navigateTo(conn.page, url, { referrer: options.referrer });
    const pageTitle = await conn.page.title().catch(() => "(unknown)");
    console.log(`  [snapshot] loaded — title: "${pageTitle}", url: ${conn.page.url()}`);

    // Dismiss cookie banners that might overlay content
    await dismissCookieBanners(conn.page);

    // Capture AX tree (optionally scoped to a selector)
    const rawNodes = selector
      ? await captureAxTreeScoped(conn.page, selector)
      : await captureAxTree(conn.page);

    const prunedNodes = pruneAxTree(rawNodes);
    const formattedRoot = buildFormattedNodes(prunedNodes, 0);
    const snapshotResult = formatTree(formattedRoot);
    enrichMapsFromAxNodes(snapshotResult, rawNodes as any, 0);
    await resolveImageSrcsFromDOM(snapshotResult, rawNodes as any, 0, conn.page);

    // Download images
    await mkdir(outputDir, { recursive: true });
    const pageName = urlToPageName(url);
    const imagePathMap = await downloadImages(snapshotResult.imageMap, outputDir, pageName, {
      minImageSize,
      minImageDim: this.options.minImageDim,
      skipSvg: this.options.skipSvg,
      fetcher: pageImageFetcher(conn.page),
    });

    // Convert Maps to Records for JSON serialization
    const urlMapRecord: Record<string, string> = {};
    for (const [k, v] of snapshotResult.urlMap) {
      urlMapRecord[k] = v;
    }

    // Build imageMap as elementId → localPath so converters can match
    // tree references like [0-123] image to their downloaded file
    const imageMapRecord: Record<string, string> = {};
    for (const [elementId, imageUrl] of snapshotResult.imageMap) {
      const localPath = imagePathMap.get(imageUrl);
      if (localPath) {
        imageMapRecord[elementId] = localPath;
      }
    }

    // Build the snapshot file
    const snapshotFile: SnapshotFile = {
      version: 1,
      url,
      title: pageTitle,
      tree: snapshotResult.tree,
      urlMap: urlMapRecord,
      imageMap: imageMapRecord,
      nodeCount: snapshotResult.nodeCount,
      capturedAt: new Date().toISOString(),
    };

    // Write snapshot to disk
    const snapshotPath = await writeSnapshot(snapshotFile, outputDir);

    return {
      snapshotFile,
      snapshotPath,
      imageCount: imagePathMap.size,
    };
  }

  /**
   * Batch snapshot with crawl state persistence and resume support.
   * Returns a SiteManifest describing all captured pages.
   */
  async snapshotMany(
    urls: string[],
    options: {
      outputDir?: string;
      selector?: string;
      minImageSize?: number;
      resume?: boolean;
      retryFailed?: boolean;
      startUrl?: string;
      match?: string[];
      siteConfigPath?: string;
    } = {}
  ): Promise<SiteManifest> {
    const outputDir = options.outputDir ?? this.options.outputDir ?? "./output";
    await mkdir(outputDir, { recursive: true });

    // Handle resume via crawl state
    let state: CrawlState | null = null;
    let workUrls = [...urls];

    if (options.resume) {
      state = await loadCrawlState(outputDir);
      if (state) {
        console.log(
          `Resuming crawl: ${state.completedUrls.length} completed, ${state.queue.length} remaining, ${state.failedUrls.length} failed`
        );
        workUrls = [...state.queue];
        if (options.retryFailed && state.failedUrls.length > 0) {
          console.log(`Retrying ${state.failedUrls.length} previously failed URLs`);
          workUrls.push(...state.failedUrls);
          state.failedUrls = [];
        }
      } else {
        console.log("No interrupted crawl found. Starting fresh.");
      }
    }

    // Initialize state if not resuming
    if (!state) {
      state = {
        version: 1,
        startUrl: options.startUrl ?? workUrls[0] ?? "",
        match: options.match,
        discoveredUrls: [...workUrls],
        completedUrls: [],
        failedUrls: [],
        excludedUrls: [],
        queue: [...workUrls],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        config: {
          selector: options.selector ?? this.options.selector,
          siteConfig: options.siteConfigPath,
          session: this.options.sessionPath,
        },
      };
      await saveCrawlState(state, outputDir);
    }

    // Validate session if one is loaded (skip when site config has startUrl —
    // those sites need the full preActions/SSO flow to establish auth)
    if (this.options.sessionPath && workUrls.length > 0 && !this.options.startUrl) {
      const { validateSession } = await import("./auth.js");
      const firstUrl = workUrls[0];
      process.stdout.write("Validating session... ");
      const valid = await validateSession(firstUrl);
      if (!valid) {
        console.log("INVALID — session may be expired.");
        console.log(`Re-authenticate with: megamaid auth ${firstUrl}`);
        console.log("Proceeding without session.\n");
        this.options.sessionPath = undefined;
      } else {
        console.log("OK\n");
      }
    }

    // Load or create SiteManifest
    let manifest = await loadSiteManifest(outputDir);
    if (!manifest) {
      manifest = {
        version: 1,
        startUrl: options.startUrl ?? state.startUrl,
        match: options.match ?? state.match,
        pageCount: 0,
        totalImages: 0,
        siteConfig: options.siteConfigPath,
        session: this.options.sessionPath,
        startedAt: state.startedAt,
        pages: [],
      };
    }

    let lastUrl: string | undefined;
    const total = state.completedUrls.length + workUrls.length;
    let completed = state.completedUrls.length;

    for (let i = 0; i < workUrls.length; i++) {
      const url = workUrls[i];

      // Human-like delay between pages (skip for first page)
      if (i > 0) {
        await humanDelay(3000, 8000);
      }

      console.log(`[${completed + 1}/${total}] ${url}`);

      try {
        const result = await this.snapshot(url, {
          outputDir,
          selector: options.selector ?? this.options.selector,
          minImageSize: options.minImageSize ?? this.options.minImageSize,
          referrer: lastUrl,
        });

        console.log(`  → "${result.snapshotFile.title}" (${result.snapshotFile.nodeCount} nodes, ${result.imageCount} images)`);

        // Update manifest
        const page: SiteManifestPage = {
          url,
          snapshot: result.snapshotPath,
          imageCount: result.imageCount,
        };
        manifest.pages.push(page);
        manifest.pageCount = manifest.pages.length;
        manifest.totalImages += result.imageCount;

        // Update crawl state
        state.completedUrls.push(url);
        state.queue = state.queue.filter((u) => u !== url);
        completed++;
        lastUrl = url;

        // Persist both after each page
        await writeSiteManifest(manifest, outputDir);
        await saveCrawlState(state, outputDir);
      } catch (err) {
        const message = (err as Error).message;
        console.error(`  ✗ Failed: ${message}`);
        state.queue = state.queue.filter((u) => u !== url);
        state.failedUrls.push(url);
        await saveCrawlState(state, outputDir);
      }
    }

    // Finalize manifest with completedAt
    manifest.completedAt = new Date().toISOString();
    await writeSiteManifest(manifest, outputDir);

    // Clean up crawl state if all done
    if (state.queue.length === 0 && state.failedUrls.length === 0) {
      await deleteCrawlState(outputDir);
    }

    await this.close();
    return manifest;
  }

  /**
   * Single-pass crawl + snapshot: BFS discovers links and captures snapshots
   * in the same page visit. Each page is visited exactly once.
   */
  async crawlAndSnapshot(
    startUrl: string,
    options: {
      match?: string[];
      maxPages?: number;
      outputDir?: string;
      selector?: string;
      minImageSize?: number;
      resume?: boolean;
      retryFailed?: boolean;
      siteConfigPath?: string;
      excludePatterns?: string[];
      preserveQuery?: boolean;
    } = {}
  ): Promise<SiteManifest> {
    const outputDir = options.outputDir ?? this.options.outputDir ?? "./output";
    const maxPages = options.maxPages ?? Infinity;
    await mkdir(outputDir, { recursive: true });

    // Normalize start URL
    const normalizedStart = startUrl.replace(/\/+$/, "");

    // Resolve query handling: option > persisted state (restored in the resume
    // branch below). Must match the setting the queue was built with, or
    // resumed crawls would re-collapse newly discovered links.
    let preserveQuery = options.preserveQuery;

    // Resolve effective excludes: option > instance option. The resume branch
    // below may additionally fall back to the persisted state.config.exclude.
    let excludePatterns = options.excludePatterns ?? this.options.excludePatterns;

    // Initialize or resume crawl state
    let state: CrawlState;
    let manifest: SiteManifest;

    if (options.resume) {
      const existingState = await loadCrawlState(outputDir);
      const existingManifest = await loadSiteManifest(outputDir);

      // Restore excludes from persisted state when not explicitly provided,
      // so resumed crawls use the same exclude set even if site config changes.
      if (!excludePatterns && existingState?.config.exclude) {
        excludePatterns = existingState.config.exclude;
      }

      if (preserveQuery === undefined && existingState?.config.preserveQuery !== undefined) {
        preserveQuery = existingState.config.preserveQuery;
      }

      if (existingState) {
        state = existingState;
        state.excludedUrls = state.excludedUrls ?? [];
        manifest = existingManifest ?? this.initManifest(normalizedStart, options);
        if (options.retryFailed && state.failedUrls.length > 0) {
          console.log(`Retrying ${state.failedUrls.length} previously failed URLs`);
          state.queue.push(...state.failedUrls);
          state.failedUrls = [];
        }
        // Migration: ensure all discovered URLs that lack snapshots are queued
        // (from old two-phase crawls where discovery visited pages without snapshotting)
        const snapshotted = new Set(manifest.pages.map((p) => p.url));
        const queueSet = new Set(state.queue);
        let requeued = 0;

        // Re-queue completedUrls missing snapshots
        state.completedUrls = state.completedUrls.filter((url) => {
          if (snapshotted.has(url)) return true;
          if (!queueSet.has(url)) {
            state.queue.push(url);
            queueSet.add(url);
            requeued++;
          }
          return false;
        });

        // Re-queue discoveredUrls not in queue, not completed, not snapshotted
        const completedSet = new Set(state.completedUrls);
        for (const url of state.discoveredUrls) {
          if (snapshotted.has(url) || completedSet.has(url) || queueSet.has(url)) continue;

          const linkPath = new URL(url).pathname;

          // Only queue if it still matches the include pattern
          if (options.match && !options.match.some((p) => matchesPattern(linkPath, p))) continue;

          // And doesn't match any current exclude
          if (excludePatterns && excludePatterns.some((p) => matchesPattern(linkPath, p))) {
            state.excludedUrls = state.excludedUrls ?? [];
            state.excludedUrls.push(url);
            continue;
          }

          state.queue.push(url);
          queueSet.add(url);
          requeued++;
        }

        if (requeued > 0) {
          console.log(`  Re-queued ${requeued} URLs missing snapshots (from prior discovery-only crawl)`);
        }

        console.log(
          `Resuming: ${state.completedUrls.length} completed, ${state.queue.length} in queue, ${state.failedUrls.length} failed, ${state.excludedUrls.length} excluded`
        );
      } else {
        console.log("No interrupted crawl found. Starting fresh.");
        state = this.initCrawlState(normalizedStart, { ...options, excludePatterns, preserveQuery });
        manifest = this.initManifest(normalizedStart, options);
      }
    } else {
      state = this.initCrawlState(normalizedStart, { ...options, excludePatterns, preserveQuery });
      manifest = this.initManifest(normalizedStart, options);
    }

    // Guard against a start URL that matches the (now-resolved) excludes.
    // Runs after resume restoration so excludes loaded from state are honored.
    if (excludePatterns && excludePatterns.length > 0) {
      const startPath = new URL(normalizedStart).pathname;
      const hit = excludePatterns.find((p) => matchesPattern(startPath, p));
      if (hit) {
        throw new Error(
          `Start URL ${normalizedStart} matches exclude pattern "${hit}" — check your site config`
        );
      }
    }

    await saveCrawlState(state, outputDir);

    // Validate session (skip for SSO sites with startUrl)
    if (this.options.sessionPath && state.queue.length > 0 && !this.options.startUrl) {
      const { validateSession } = await import("./auth.js");
      process.stdout.write("Validating session... ");
      const valid = await validateSession(state.queue[0]);
      if (!valid) {
        console.log("INVALID — session may be expired.");
        console.log(`Re-authenticate with: megamaid auth ${state.queue[0]}`);
        console.log("Proceeding without session.\n");
        this.options.sessionPath = undefined;
      } else {
        console.log("OK\n");
      }
    }

    let completed = state.completedUrls.length;
    let failed = state.failedUrls.length;
    let lastUrl: string | undefined;

    try {
      while (state.queue.length > 0 && completed < maxPages) {
        const url = state.queue.shift()!;

        // Human-like delay (skip first page)
        if (completed > 0) {
          await humanDelay(3000, 8000);
        }

        const done = completed + failed;
        const total = done + state.queue.length + 1; // +1 for current
        const pct = Math.round(((done + 1) / total) * 100);
        const barWidth = 20;
        const filled = Math.round((pct / 100) * barWidth);
        const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
        console.log(`[${done + 1}/${total}] ${bar} ${pct}% | ${url}`);

        try {
          // Snapshot the page (reuses browser session)
          const result = await this.snapshot(url, {
            outputDir,
            selector: options.selector ?? this.options.selector,
            minImageSize: options.minImageSize ?? this.options.minImageSize,
            referrer: lastUrl,
          });

          console.log(`  → "${result.snapshotFile.title}" (${result.snapshotFile.nodeCount} nodes, ${result.imageCount} images)`);

          // Discover new links from the snapshot's urlMap
          const snapshotUrlMap = new Map(Object.entries(result.snapshotFile.urlMap));
          const newLinks = extractLinks(snapshotUrlMap, startUrl, { preserveQuery });
          let added = 0;
          const discovered = new Set(state.discoveredUrls);
          for (const link of newLinks) {
            if (discovered.has(link)) continue;
            discovered.add(link);
            state.discoveredUrls.push(link);

            const linkPath = new URL(link).pathname;

            // Only queue links matching the include pattern
            if (options.match && !options.match.some((p) => matchesPattern(linkPath, p))) continue;

            // Reject links matching any exclude pattern
            if (excludePatterns && excludePatterns.some((p) => matchesPattern(linkPath, p))) {
              state.excludedUrls.push(link);
              continue;
            }

            state.queue.push(link);
            added++;
          }
          if (added > 0) {
            console.log(`  ↳ ${added} new URLs queued (queue: ${state.queue.length})`);
          }

          // Update manifest
          const page: SiteManifestPage = {
            url,
            snapshot: result.snapshotPath,
            imageCount: result.imageCount,
          };
          manifest.pages.push(page);
          manifest.pageCount = manifest.pages.length;
          manifest.totalImages += result.imageCount;

          // Update crawl state
          state.completedUrls.push(url);
          completed++;
          lastUrl = url;

          // Persist both after each page
          await writeSiteManifest(manifest, outputDir);
          await saveCrawlState(state, outputDir);
        } catch (err) {
          const message = (err as Error).message;
          console.error(`  ✗ Failed: ${message}`);
          state.failedUrls.push(url);
          failed++;
          await saveCrawlState(state, outputDir);
        }
      }
    } finally {
      // Finalize
      manifest.completedAt = new Date().toISOString();
      await writeSiteManifest(manifest, outputDir);

      if (state.queue.length === 0 && state.failedUrls.length === 0) {
        await deleteCrawlState(outputDir);
      }

      await this.close();
    }

    return manifest;
  }

  private initCrawlState(
    normalizedStart: string,
    options: {
      match?: string[];
      selector?: string;
      siteConfigPath?: string;
      excludePatterns?: string[];
      preserveQuery?: boolean;
    }
  ): CrawlState {
    return {
      version: 1,
      startUrl: normalizedStart,
      match: options.match,
      discoveredUrls: [normalizedStart],
      completedUrls: [],
      failedUrls: [],
      excludedUrls: [],
      queue: [normalizedStart],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {
        selector: options.selector ?? this.options.selector,
        siteConfig: options.siteConfigPath,
        session: this.options.sessionPath,
        exclude: options.excludePatterns,
        preserveQuery: options.preserveQuery,
      },
    };
  }

  private initManifest(
    normalizedStart: string,
    options: { match?: string[]; siteConfigPath?: string }
  ): SiteManifest {
    return {
      version: 1,
      startUrl: normalizedStart,
      match: options.match,
      pageCount: 0,
      totalImages: 0,
      siteConfig: options.siteConfigPath,
      session: this.options.sessionPath,
      startedAt: new Date().toISOString(),
      pages: [],
    };
  }
}

/**
 * Build an image fetcher that reuses the authenticated browser session.
 *
 * Primary path is an in-page `fetch()` run through the page's own networking
 * stack. This matters because asset endpoints behind a CDN/WAF (e.g. Zendesk
 * theming_assets) 403 the separate `page.request` HTTP client — it lacks the
 * browser's full request fingerprint — yet serve an in-page fetch normally.
 *
 * Falls back to `page.request` for cross-origin assets the in-page fetch can't
 * read because of CORS (its body would otherwise be opaque/unreadable).
 */
function pageImageFetcher(page: Page): ImageFetcher {
  return async (url: string) => {
    const viaPage = await page
      .evaluate(async (u) => {
        try {
          const resp = await fetch(u, { credentials: "include" });
          if (!resp.ok) return { ok: false, status: resp.status, contentType: "", b64: "" };
          const bytes = new Uint8Array(await resp.arrayBuffer());
          let binary = "";
          const CHUNK = 0x8000; // chunk to avoid arg-count limits on fromCharCode
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
          }
          return {
            ok: true,
            status: resp.status,
            contentType: resp.headers.get("content-type") ?? "",
            b64: btoa(binary),
          };
        } catch {
          // CORS rejection, CSP block, network error — signal a fallback.
          return { ok: false, status: -1, contentType: "", b64: "" };
        }
      }, url)
      .catch(() => ({ ok: false, status: -1, contentType: "", b64: "" }));

    if (viaPage.ok) {
      return {
        ok: true,
        status: viaPage.status,
        contentType: viaPage.contentType,
        body: Buffer.from(viaPage.b64, "base64"),
      };
    }

    const response = await page.request.get(url);
    return {
      ok: response.ok(),
      status: response.status(),
      contentType: response.headers()["content-type"] ?? "",
      body: await response.body(),
    };
  };
}

// Re-exported for existing importers; implementation lives in its own module
// so snapshotWriter (snapshot filenames) and this file (image folders) agree.
export { urlToPageName };
