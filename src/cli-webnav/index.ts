#!/usr/bin/env node
import { Command } from "commander";
import { createFetchCommand } from "./fetch.js";

const program = new Command()
  .name("webnav")
  .description(
    "Authenticated web navigation for agents. Forks megamaid's auth + preActions plumbing — opens a single page through a real Playwright browser, runs siteconfig pre-actions, and emits the page contents in the format you ask for. No crawl, no analyze, no blow.",
  )
  .version("0.1.0")
  .addHelpText(
    "after",
    `
Examples:
  # Capture a page's accessibility tree, scoped to <main>, with cookies + siteconfig
  webnav fetch https://app.example.com/dashboard \\
    --site-config example --cookies-env MEGAMAID_COOKIES \\
    --format ax --selector main

  # Just enumerate links on a page (token-cheap recon)
  webnav fetch https://app.example.com/news --format links

  # HTML for downstream parsing, written to file
  webnav fetch https://example.com/page --format html --out /tmp/page.html
`,
  );

program.addCommand(createFetchCommand());

program.parse();
