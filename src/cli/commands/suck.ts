// src/cli/commands/suck.ts
import { Command } from "commander";
import { Megamaid } from "../../core/megamaid.js";
import { readFile } from "fs/promises";
import { resolveSiteConfigPath } from "../../core/siteConfigResolver.js";

export function createSuckCommand(): Command {
  const cmd = new Command("suck")
    .description("Capture AX tree snapshots of web pages for later conversion to Markdown")
    .addHelpText("after", `
Examples:
  # Snapshot a single page
  megamaid suck https://example.com/docs/getting-started

  # Crawl a site section (start URL should be within the match pattern)
  megamaid suck --crawl https://docs.example.com/api --match "/api/**"

  # Crawl category pages and their linked product pages
  megamaid suck --crawl https://www.heb.com/category/shop/deli \
    --match "/category/shop/deli/**" --match "/product-detail/**"

  # Resume an interrupted crawl
  megamaid suck --crawl https://docs.example.com/api --match "/api/**" --resume

  # Use a saved browser session for authenticated sites
  megamaid suck --crawl https://internal.example.com/docs --session

Output:
  Writes to --out directory (default ./output/):
    site.json          Site manifest listing all captured pages
    snapshots/*.json   One AX tree snapshot per page
    images/*/          Downloaded images per page

  After suck completes, run 'megamaid analyze' to generate
  a converter.py, then run 'megamaid blow <dir>' to produce Markdown.

Crawl behavior:
  --crawl sets the BFS starting page. Each page is visited once — links are
  discovered and the snapshot is captured in the same visit. --match filters
  which discovered links get queued (repeatable — a link matching any pattern
  is queued). When --match is omitted, it is auto-derived from the crawl URL
  path (e.g. --crawl https://example.com/docs → --match "/docs/**").
  To crawl an entire site, pass --match "/**" explicitly.
`)
    .argument("[urls...]", "One or more URLs to snapshot")
    .option("--urls <file>", "Read URLs from a file (one per line, # comments allowed)")
    .option("--out <dir>", "Output directory for snapshots, images, and site.json", process.env.MEGAMAID_SUCK_OUT ?? "./output")
    .option("--cdp-url <url>", "Connect to an already-running Chrome instance via CDP URL")
    .option("--selector <selector>", "CSS/XPath selector to scope the snapshot to a page region")
    .option("--min-image-size <bytes>", "Skip images smaller than this in bytes (0 to disable)", "0")
    .option("--min-image-dim <pixels>", "Skip images where both dimensions are below this (filters icons/spacers)", "150")
    .option("--skip-svg", "Skip all SVG images (theme icons, logos)")
    .option("--concurrency <n>", "Max parallel page snapshots", "3")
    .option("--crawl <url>", "Enable crawl mode: BFS from this URL, discovering same-origin links")
    .option("--match <pattern>", "Only queue crawled URLs matching this glob (repeatable, e.g. --match \"/docs/**\" --match \"/api/**\")", (val: string, prev: string[] | undefined) => prev ? [...prev, val] : [val])
    .option("--max-pages <n>", "Stop crawling after this many pages (default: unlimited)")
    .option("--resume", "Resume a previously interrupted crawl from the state file in --out")
    .option("--retry-failed", "When resuming, also retry URLs that failed in the previous run")
    .option("--proxy <url>", "Route browser traffic through this proxy (http:// or socks5://)")
    .option("--headed", "Show the browser window (useful for debugging or auth)")
    .option("--session [name]", "Load a saved browser session (profile name or hostname; auto-detected from URL if omitted)")
    .option("--site-config <name|path>", "Site config with preActions for login/interstitials (bare name resolves to sites/<name>.toml)")
    .option("--cookies-env <var>", "Read cookies JSON array from this env var (for containerized/headless auth)")
    .action(async (urlArgs: string[], opts) => {
      try {
        // Load saved browser session early (needed for crawl + snapshot)
        let sessionPath: string | undefined;
        if (opts.session !== undefined) {
          const { loadSession, hostnameFromUrl } = await import("../../core/auth.js");
          const hostname = typeof opts.session === "string"
            ? opts.session
            : hostnameFromUrl(urlArgs[0] ?? opts.crawl);
          sessionPath = (await loadSession(hostname)) ?? undefined;
          if (sessionPath) {
            console.log(`Using saved session for ${hostname}`);
          } else {
            console.log(`No saved session for ${hostname}.`);
          }
        }

        // Load site config early (needed for preActions in crawl)
        let siteConfig: import("../../types/index.js").SiteConfig | undefined;
        let siteConfigPreActions: import("../../types/index.js").PreAction[] | undefined;
        if (opts.siteConfig) {
          const siteConfigPath = await resolveSiteConfigPath(opts.siteConfig);
          console.log(`Loading site config from ${siteConfigPath}...`);
          const { loadSiteConfig } = await import("../../core/siteConfig.js");
          siteConfig = await loadSiteConfig(siteConfigPath);
          siteConfigPreActions = siteConfig.preActions;
        }

        // Parse cookies from env var if specified (needed for both crawl and snapshot)
        let cookies: any[] | undefined;
        if (opts.cookiesEnv) {
          const raw = process.env[opts.cookiesEnv];
          if (!raw) {
            console.error(`Environment variable ${opts.cookiesEnv} is not set.`);
            process.exit(1);
          }
          try {
            cookies = JSON.parse(raw);
            if (!Array.isArray(cookies)) throw new Error("not an array");
            console.log(`Loaded ${cookies.length} cookies from $${opts.cookiesEnv}`);
          } catch (err) {
            console.error(`Failed to parse cookies from $${opts.cookiesEnv}: ${(err as Error).message}`);
            console.error(`Expected JSON array: [{"name":"...","value":"...","domain":"..."}]`);
            process.exit(1);
          }
        }

        // Create Megamaid instance (used by both crawl and non-crawl paths)
        const megamaid = new Megamaid({
          cdpUrl: opts.cdpUrl,
          concurrency: parseInt(opts.concurrency),
          sessionPath,
          preActions: siteConfigPreActions,
          startUrl: siteConfig?.startUrl,
          headed: opts.headed,
          proxy: opts.proxy,
          selector: opts.selector,
          minImageSize: parseInt(opts.minImageSize),
          minImageDim: parseInt(opts.minImageDim),
          skipSvg: opts.skipSvg ?? false,
          outputDir: opts.out,
          cookies,
          excludePatterns: siteConfig?.exclude,
        });

        if (opts.crawl) {
          // --retry-failed implies --resume
          if (opts.retryFailed && !opts.resume) {
            opts.resume = true;
            console.log(`Note: --retry-failed implies --resume`);
          }

          // Precedence: CLI --match > site config match > auto-derive from crawl URL path
          if (!opts.match && siteConfig?.match) {
            opts.match = siteConfig.match;
            console.log(`Match from site config: ${JSON.stringify(opts.match)}`);
          }
          if (!opts.match) {
            const crawlPath = new URL(opts.crawl).pathname.replace(/\/+$/, "");
            if (crawlPath && crawlPath !== "/") {
              opts.match = [`${crawlPath}/**`];
              console.log(`Auto-match: "${opts.match[0]}" (derived from crawl URL, use --match to override)`);
            }
          }

          // Block overwriting an existing crawl without --resume
          if (!opts.resume) {
            const { detectInterruptedCrawl } = await import("../../core/crawlState.js");
            const detected = await detectInterruptedCrawl(opts.out);
            if (detected.found && detected.info!.pagesCompleted > 0) {
              console.error(`\nERROR: Found existing crawl in ${opts.out}/`);
              console.error(`  ${detected.info!.pagesCompleted} completed, ${detected.info!.pagesRemaining} remaining`);
              console.error(`  Use --resume to continue, or delete ${opts.out}/.megamaid-state.json to start fresh.`);
              process.exit(1);
            }
          }

          const manifest = await megamaid.crawlAndSnapshot(opts.crawl, {
            match: opts.match,
            maxPages: opts.maxPages ? parseInt(opts.maxPages) : undefined,
            outputDir: opts.out,
            selector: opts.selector,
            minImageSize: parseInt(opts.minImageSize),
            resume: opts.resume,
            retryFailed: opts.retryFailed,
            siteConfigPath: opts.siteConfig ? await resolveSiteConfigPath(opts.siteConfig) : undefined,
            excludePatterns: siteConfig?.exclude,
          });

          console.log(`\nDone. ${manifest.pageCount} pages snapshotted to ${opts.out}/`);
          console.log(`Total images: ${manifest.totalImages}`);
          console.log(`\nNext step: Run 'megamaid analyze' to generate a converter.`);
          return;
        }

        // Non-crawl mode: snapshot explicit URLs
        let urls = [...urlArgs];
        if (opts.urls) {
          const content = await readFile(opts.urls, "utf-8");
          const fileUrls = content
            .split("\n")
            .map((line: string) => line.trim())
            .filter((line: string) => line && !line.startsWith("#"));
          urls.push(...fileUrls);
        }

        // Deduplicate URLs
        urls = [...new Set(urls)];

        if (urls.length === 0) {
          console.error("No URLs provided. Pass URLs as arguments or use --urls <file>.");
          process.exit(1);
        }

        console.log(`Snapshotting ${urls.length} page(s)...\n`);

        const manifest = await megamaid.snapshotMany(urls, {
          outputDir: opts.out,
          selector: opts.selector,
          minImageSize: parseInt(opts.minImageSize),
          resume: opts.resume,
          retryFailed: opts.retryFailed,
          siteConfigPath: opts.siteConfig ? await resolveSiteConfigPath(opts.siteConfig) : undefined,
        });

        console.log(`\nDone. ${manifest.pageCount} pages snapshotted to ${opts.out}/`);
        console.log(`Total images: ${manifest.totalImages}`);
        console.log(`\nNext step: Run 'megamaid analyze' to generate a converter.`);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}

