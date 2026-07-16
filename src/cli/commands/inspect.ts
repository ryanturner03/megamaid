// src/cli/commands/inspect.ts
import { Command } from "commander";
import { connectBrowser, navigateTo, closeBrowser, dismissCookieBanners } from "../../core/browser.js";
import { executePreActions } from "../../core/preActions.js";
import { captureAxTree } from "../../core/snapshot/capture.js";
import { pruneAxTree, buildFormattedNodes } from "../../core/snapshot/a11yTree.js";
import { formatTree, enrichMapsFromAxNodes } from "../../core/snapshot/treeFormatter.js";
import { extractLinks } from "../../core/crawler.js";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export function createInspectCommand(): Command {
  const cmd = new Command("inspect")
    .description("Inspect what megamaid sees on a page (accessibility tree, links, page state)")
    .argument("<url>", "URL to inspect")
    .option("--session <name>", "Use a saved browser session by name")
    .option("--site-config <name|path>", "Site config (for preActions/startUrl)")
    .option("--out <dir>", "Save snapshot to a file in this directory")
    .option("--headed", "Run browser in headed mode")
    .action(async (url: string, opts) => {
      try {
        // Load session
        let sessionPath: string | undefined;
        if (opts.session) {
          const { loadSession } = await import("../../core/auth.js");
          sessionPath = (await loadSession(opts.session)) ?? undefined;
          if (sessionPath) {
            console.log(`Using saved session for ${opts.session}`);
          } else {
            console.log(`No saved session for ${opts.session}.`);
          }
        }

        // Load site config for preActions
        let preActions: import("../../types/index.js").PreAction[] | undefined;
        let startUrl: string | undefined;
        if (opts.siteConfig) {
          const { resolveSiteConfigPath } = await import("../../core/siteConfigResolver.js");
          const configPath = await resolveSiteConfigPath(opts.siteConfig);
          console.log(`Loading site config from ${configPath}...`);
          const { loadSiteConfig } = await import("../../core/siteConfig.js");
          const siteConfig = await loadSiteConfig(configPath);
          preActions = siteConfig.preActions;
          startUrl = siteConfig.startUrl;
        }

        // Connect
        console.log(`\nConnecting browser...`);
        const conn = await connectBrowser({
          sessionPath,
          headless: opts.headed ? false : true,
        });

        try {
          // Run preActions if configured
          if (preActions?.length) {
            console.log(`Running preActions...`);
            await executePreActions(conn.page, preActions, { startUrl });
          }

          // Navigate
          console.log(`Navigating to ${url}...`);
          await navigateTo(conn.page, url);
          await dismissCookieBanners(conn.page);

          const pageTitle = await conn.page.title();
          const pageUrl = conn.page.url();

          console.log(`\n${"=".repeat(70)}`);
          console.log(`PAGE STATE`);
          console.log(`${"=".repeat(70)}`);
          console.log(`  Title: ${pageTitle}`);
          console.log(`  URL:   ${pageUrl}`);

          // Capture accessibility tree
          console.log(`\nCapturing accessibility tree...`);
          const rawNodes = await captureAxTree(conn.page);
          const pruned = pruneAxTree(rawNodes);
          const formatted = buildFormattedNodes(pruned, 0);
          const snapshot = formatTree(formatted);
          enrichMapsFromAxNodes(snapshot, rawNodes as any, 0);

          console.log(`\n${"=".repeat(70)}`);
          console.log(`ACCESSIBILITY TREE (${snapshot.nodeCount} nodes)`);
          console.log(`${"=".repeat(70)}`);

          // Show first 100 lines of tree
          const treeLines = snapshot.tree.split("\n");
          const previewLines = treeLines.slice(0, 100);
          console.log(previewLines.join("\n"));
          if (treeLines.length > 100) {
            console.log(`  ... (${treeLines.length - 100} more lines)`);
          }

          // Links
          const links = extractLinks(snapshot.urlMap, url);
          console.log(`\n${"=".repeat(70)}`);
          console.log(`LINKS DISCOVERED (${links.length} total, ${snapshot.urlMap.size} in URL map)`);
          console.log(`${"=".repeat(70)}`);
          for (const link of links.slice(0, 50)) {
            console.log(`  ${link}`);
          }
          if (links.length > 50) {
            console.log(`  ... (${links.length - 50} more)`);
          }

          // Images
          console.log(`\n${"=".repeat(70)}`);
          console.log(`IMAGES (${snapshot.imageMap.size})`);
          console.log(`${"=".repeat(70)}`);
          for (const [id, src] of [...snapshot.imageMap.entries()].slice(0, 20)) {
            console.log(`  ${id}: ${src.substring(0, 100)}`);
          }
          if (snapshot.imageMap.size > 20) {
            console.log(`  ... (${snapshot.imageMap.size - 20} more)`);
          }

          // Save full snapshot if --out provided
          if (opts.out) {
            await mkdir(opts.out, { recursive: true });
            const hostname = new URL(pageUrl).hostname;
            const pageName = new URL(pageUrl).pathname.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "index";

            const treePath = path.join(opts.out, `${pageName}-tree.txt`);
            await writeFile(treePath, snapshot.tree, "utf-8");
            console.log(`\nFull tree saved to ${treePath} (${treeLines.length} lines)`);

            const linksPath = path.join(opts.out, `${pageName}-links.txt`);
            await writeFile(linksPath, links.join("\n"), "utf-8");
            console.log(`Links saved to ${linksPath}`);
          }

          console.log("");
        } finally {
          await closeBrowser(conn);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
