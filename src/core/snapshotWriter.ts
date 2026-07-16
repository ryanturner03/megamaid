// src/core/snapshotWriter.ts
import { writeFile, readFile, mkdir, rename } from "fs/promises";
import path from "path";
import type { SnapshotFile, SiteManifest } from "../types/index.js";

const SNAPSHOTS_DIR = "snapshots";
const MANIFEST_FILENAME = "site.json";

export async function writeSnapshot(
  snapshot: SnapshotFile,
  outputDir: string
): Promise<string> {
  const snapshotsDir = path.join(outputDir, SNAPSHOTS_DIR);
  await mkdir(snapshotsDir, { recursive: true });

  const pageName = urlToPageName(snapshot.url);
  const relativePath = path.join(SNAPSHOTS_DIR, `${pageName}.json`);
  const fullPath = path.join(outputDir, relativePath);

  const tmpPath = fullPath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
  await rename(tmpPath, fullPath);

  return relativePath;
}

export async function writeSiteManifest(
  manifest: SiteManifest,
  outputDir: string
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const fullPath = path.join(outputDir, MANIFEST_FILENAME);
  const tmpPath = fullPath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
  await rename(tmpPath, fullPath);
}

export async function loadSiteManifest(
  outputDir: string
): Promise<SiteManifest | null> {
  const fullPath = path.join(outputDir, MANIFEST_FILENAME);
  try {
    const content = await readFile(fullPath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed.version !== 1) return null;
    // Normalize legacy string match to array
    if (typeof parsed.match === "string") {
      parsed.match = [parsed.match];
    }
    return parsed as SiteManifest;
  } catch {
    return null;
  }
}

function urlToPageName(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname
      .replace(/^\/|\/$/g, "")
      .split("/")
      .filter(Boolean);

    if (pathParts.length === 0) return parsed.hostname.replace(/\./g, "-");

    return pathParts
      .join("-")
      .replace(/[^a-zA-Z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .substring(0, 80);
  } catch {
    return "page";
  }
}
