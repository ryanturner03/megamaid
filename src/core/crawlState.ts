// src/core/crawlState.ts
import { writeFile, readFile, rename, unlink } from "fs/promises";
import path from "path";
import type { CrawlState, CrawlStateInfo } from "../types/index.js";

const STATE_FILENAME = ".megamaid-state.json";

export async function saveCrawlState(state: CrawlState, stateDir: string): Promise<void> {
  const statePath = path.join(stateDir, STATE_FILENAME);
  const tmpPath = statePath + ".tmp";

  state.updatedAt = new Date().toISOString();

  await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmpPath, statePath);
}

export async function loadCrawlState(stateDir: string): Promise<CrawlState | null> {
  const statePath = path.join(stateDir, STATE_FILENAME);
  try {
    const content = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed.version !== 1) return null;
    // Normalize legacy string match to array
    if (typeof parsed.match === "string") {
      parsed.match = [parsed.match];
    }
    return parsed as CrawlState;
  } catch {
    return null;
  }
}

export async function detectInterruptedCrawl(
  stateDir: string
): Promise<{ found: boolean; info?: CrawlStateInfo }> {
  const state = await loadCrawlState(stateDir);
  if (!state) return { found: false };

  return {
    found: true,
    info: {
      pagesCompleted: state.completedUrls.length,
      pagesRemaining: state.queue.length,
      pagesFailed: state.failedUrls.length,
      pagesExcluded: state.excludedUrls?.length ?? 0,
      lastUpdated: state.updatedAt,
      startUrl: state.startUrl,
    },
  };
}

export async function deleteCrawlState(stateDir: string): Promise<void> {
  const statePath = path.join(stateDir, STATE_FILENAME);
  try {
    await unlink(statePath);
  } catch {
    // File doesn't exist — that's fine
  }
}
