// src/core/output/indexManifest.ts
import type { SiteManifestPage } from "../../types/index.js";

export function generateManifest(
  siteName: string,
  pages: SiteManifestPage[]
): string {
  const date = new Date().toISOString().split("T")[0];
  const lines: string[] = [];

  lines.push(`# ${siteName} — ${date}\n`);

  lines.push("| Page | Snapshot | Images |");
  lines.push("|------|----------|--------|");

  let totalImages = 0;

  for (const page of pages) {
    const displayUrl = page.url.length > 60 ? "..." + page.url.slice(-57) : page.url;
    lines.push(
      `| ${displayUrl} | ${page.snapshot} | ${page.imageCount} |`
    );
    totalImages += page.imageCount;
  }

  lines.push("");
  lines.push(
    `Total: ${pages.length} pages, ${totalImages} images`
  );

  return lines.join("\n") + "\n";
}
