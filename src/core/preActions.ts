// src/core/preActions.ts
import type { Page } from "playwright";
import type { PreAction } from "../types/index.js";
import { navigateTo } from "./browser.js";

/**
 * Interpolate environment variables in a string.
 * Supports $VAR and ${VAR} syntax.
 */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, braced, bare) => {
    const name = braced ?? bare;
    const val = process.env[name];
    if (val === undefined) {
      throw new Error(`Environment variable ${name} is not set (referenced in preAction value)`);
    }
    return val;
  });
}

function logState(page: Page, label: string): void {
  const url = page.url();
  console.error(`  [preActions] ${label}`);
  console.error(`    url: ${url}`);
}

/**
 * Execute a sequence of pre-actions on a page.
 * Logs every step for diagnostic visibility.
 *
 * Actions are best-effort: if a selector isn't found (e.g., the interstitial
 * isn't present on this page), the action is skipped and remaining actions
 * are aborted (since they likely depend on the skipped one).
 */
export async function executePreActions(
  page: Page,
  actions: PreAction[],
  opts?: { startUrl?: string }
): Promise<void> {
  // If a startUrl is configured, navigate there first (e.g., login page)
  if (opts?.startUrl) {
    console.error(`  [preActions] navigating to startUrl: ${opts.startUrl}`);
    try {
      await navigateTo(page, opts.startUrl);
    } catch (err) {
      console.error(`  [preActions] startUrl navigation failed: ${(err as Error).message?.substring(0, 120)}`);
      return;
    }
    const title = await page.title().catch(() => "(unknown)");
    console.error(`  [preActions] startUrl loaded — title: "${title}", url: ${page.url()}`);
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const step = `[preActions] step ${i + 1}/${actions.length}`;

    try {
      switch (action.action) {
        case "click": {
          console.error(`  ${step}: click → ${action.selector}`);
          const el = await page.waitForSelector(action.selector, { timeout: 5_000 });
          try {
            await el!.click({ timeout: 5_000 });
          } catch {
            await el!.evaluate((e: any) => e.click());
            console.error(`    (used JS fallback click)`);
          }
          console.error(`    ok`);
          break;
        }
        case "type": {
          const masked = action.value.startsWith("$") ? action.value : "***";
          console.error(`  ${step}: type → ${action.selector} (value: ${masked})`);
          const el = await page.waitForSelector(action.selector, { timeout: 5_000 });
          await el!.fill(interpolateEnv(action.value));
          console.error(`    ok`);
          break;
        }
        case "wait": {
          console.error(`  ${step}: wait → ${action.selector} (timeout: ${action.timeout ?? 30000}ms)`);
          await page.waitForSelector(action.selector, { timeout: action.timeout ?? 30_000 });
          console.error(`    ok`);
          break;
        }
        case "delay": {
          console.error(`  ${step}: delay ${action.ms}ms`);
          await page.waitForTimeout(action.ms);
          console.error(`    ok`);
          break;
        }
      }

      // Log page state after each action (URL may change after clicks)
      const currentUrl = page.url();
      const prevUrl = i > 0 ? page.url() : opts?.startUrl;
      if (action.action === "click") {
        const title = await page.title().catch(() => "(unknown)");
        console.error(`    page: "${title}" — ${currentUrl}`);
      }
    } catch (err) {
      const desc = action.action === "delay" ? `delay ${action.ms}ms` : `${action.action} → ${(action as any).selector}`;
      console.error(`  ${step}: SKIPPED "${desc}"`);
      console.error(`    error: ${(err as Error).message?.substring(0, 120)}`);
      console.error(`    page url: ${page.url()}`);
      const title = await page.title().catch(() => "(unknown)");
      console.error(`    page title: "${title}"`);
      console.error(`  [preActions] aborting remaining actions (interstitial likely not present)`);
      return;
    }
  }

  // Wait for any navigation triggered by the actions (SSO redirects, form submissions)
  console.error(`  [preActions] waiting for navigation to settle...`);
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    console.error(`  [preActions] networkidle timed out — proceeding anyway`);
  }
  const finalTitle = await page.title().catch(() => "(unknown)");
  console.error(`  [preActions] done — title: "${finalTitle}", url: ${page.url()}`);
}
