// src/cli-webnav/fetch.ts
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import {
  connectBrowser,
  navigateTo,
  closeBrowser,
  dismissCookieBanners,
  type CookieParam,
} from "../core/browser.js";
import { executePreActions } from "../core/preActions.js";
import { resolveSiteConfigPath } from "../core/siteConfigResolver.js";
import { loadSiteConfig } from "../core/siteConfig.js";
import { captureAxTree, captureAxTreeScoped } from "../core/snapshot/capture.js";
import { pruneAxTree, buildFormattedNodes } from "../core/snapshot/a11yTree.js";
import { formatTree } from "../core/snapshot/treeFormatter.js";
import { extractLinks } from "../core/crawler.js";
import type { Page } from "playwright";

type Format = "html" | "text" | "ax" | "links";

const VALID_FORMATS: Format[] = ["html", "text", "ax", "links"];

export function createFetchCommand(): Command {
  return new Command("fetch")
    .description(
      "Open a single URL through an authenticated Playwright session and emit its contents.",
    )
    .argument("<url>", "URL to fetch")
    .option(
      "--format <format>",
      `Output format: ${VALID_FORMATS.join(" | ")}`,
      "ax",
    )
    .option(
      "--selector <css>",
      "Scope output to elements matching this CSS selector (ax/text only)",
    )
    .option(
      "--site-config <name|path>",
      "Megamaid site config (bare name resolves to ~/.megamaid/sites/<name>.toml)",
    )
    .option(
      "--cookies-env <var>",
      "Environment variable holding a JSON cookie array (Playwright shape)",
    )
    .option(
      "--session <name>",
      "Use a saved megamaid session (~/.megamaid/sessions/<name>.json)",
    )
    .option("--proxy <url>", "Proxy URL (http://, https://, socks5://)")
    .option(
      "--out <path>",
      "Write output to this file instead of stdout (also returns path on stdout)",
    )
    .option(
      "--timeout <ms>",
      "Page load timeout in milliseconds",
      (v) => parseInt(v, 10),
      30_000,
    )
    .option("--headed", "Run browser in headed mode (debugging)")
    .action(async (url: string, opts) => {
      const format = (opts.format as Format) ?? "ax";
      if (!VALID_FORMATS.includes(format)) {
        die(
          `Invalid --format "${format}". Must be one of: ${VALID_FORMATS.join(", ")}`,
        );
      }
      if (opts.selector && (format === "html" || format === "links")) {
        warn(
          `--selector has no effect with --format ${format}; ignoring.`,
        );
      }

      const cookies = opts.cookiesEnv ? loadCookies(opts.cookiesEnv) : undefined;

      let sessionPath: string | undefined;
      if (opts.session) {
        const { loadSession } = await import("../core/auth.js");
        sessionPath = (await loadSession(opts.session)) ?? undefined;
        if (!sessionPath) {
          warn(`No saved session for "${opts.session}". Continuing without it.`);
        }
      }

      let preActions: import("../types/index.js").PreAction[] | undefined;
      let siteStartUrl: string | undefined;
      if (opts.siteConfig) {
        const path = await resolveSiteConfigPath(opts.siteConfig);
        const config = await loadSiteConfig(path);
        preActions = config.preActions;
        siteStartUrl = config.startUrl;
      }

      const conn = await connectBrowser({
        headless: !opts.headed,
        cookies,
        sessionPath,
        proxy: opts.proxy,
      });

      try {
        // Bootstrap auth: navigate to startUrl (e.g. SSO launcher) and run any
        // preActions before hitting the target URL. Run this whenever EITHER is
        // configured — siteconfigs can specify startUrl alone (no actions) and
        // still need the bootstrap for silent SSO redirects.
        if (siteStartUrl || preActions?.length) {
          await executePreActions(conn.page, preActions ?? [], {
            startUrl: siteStartUrl,
          });
        }

        await navigateTo(conn.page, url, { timeout: opts.timeout });
        await dismissCookieBanners(conn.page);

        const output = await renderOutput(conn.page, format, opts.selector, url);
        if (opts.out) {
          await writeFile(opts.out, output, "utf-8");
          process.stdout.write(`${opts.out}\n`);
        } else {
          process.stdout.write(output);
          if (!output.endsWith("\n")) process.stdout.write("\n");
        }
      } finally {
        await closeBrowser(conn);
      }
    });
}

async function renderOutput(
  page: Page,
  format: Format,
  selector: string | undefined,
  baseUrl: string,
): Promise<string> {
  switch (format) {
    case "html": {
      // Selector ignored on purpose — full HTML is what callers want here.
      return await page.content();
    }
    case "text": {
      if (selector) {
        const text = await page.locator(selector).first().innerText();
        return text;
      }
      return await page.locator("body").innerText();
    }
    case "ax": {
      const rawNodes = selector
        ? await captureAxTreeScoped(page, selector)
        : await captureAxTree(page);
      const pruned = pruneAxTree(rawNodes);
      const formatted = buildFormattedNodes(pruned, 0);
      const snapshot = formatTree(formatted);
      return snapshot.tree;
    }
    case "links": {
      const rawNodes = await captureAxTree(page);
      const pruned = pruneAxTree(rawNodes);
      const formatted = buildFormattedNodes(pruned, 0);
      const snapshot = formatTree(formatted);
      const links = extractLinks(snapshot.urlMap, baseUrl);
      return links.join("\n");
    }
  }
}

function loadCookies(envName: string): CookieParam[] {
  const raw = process.env[envName];
  if (!raw) {
    die(`Environment variable ${envName} is not set.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    die(
      `Failed to parse $${envName}: ${(err as Error).message}. Expected a JSON array of cookies.`,
    );
  }
  if (!Array.isArray(parsed)) {
    die(`$${envName} must be a JSON array of cookies.`);
  }
  return parsed as CookieParam[];
}

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function warn(msg: string): void {
  process.stderr.write(`warning: ${msg}\n`);
}
