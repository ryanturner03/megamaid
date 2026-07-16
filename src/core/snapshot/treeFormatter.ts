// src/core/snapshot/treeFormatter.ts
import type { Page } from "playwright";
import type { FormattedNode, SnapshotResult } from "../../types/index.js";

export function formatTree(root: FormattedNode): SnapshotResult {
  const lines: string[] = [];
  const urlMap = new Map<string, string>();
  const imageMap = new Map<string, string>();
  let nodeCount = 0;

  function walk(node: FormattedNode, depth: number): void {
    nodeCount++;
    const indent = "  ".repeat(depth);
    const levelStr = node.level ? ` (level=${node.level})` : "";
    const nameStr = node.name ? `: "${node.name}"` : "";

    lines.push(`${indent}[${node.id}] ${node.role}${levelStr}${nameStr}`);

    for (const child of node.children) {
      walk(child, depth + 1);
    }
  }

  walk(root, 0);

  return {
    tree: lines.join("\n"),
    urlMap,
    imageMap,
    nodeCount,
  };
}

/**
 * Enhanced formatTree that also extracts URL and image maps
 * from the raw AX nodes. Called after pruning + building formatted nodes.
 */
export function enrichMapsFromAxNodes(
  result: SnapshotResult,
  axNodes: { nodeId: string; backendDOMNodeId?: number; role: { value: string }; properties?: { name: string; value: { value?: string } }[] }[],
  frameOrdinal: number
): void {
  for (const node of axNodes) {
    const backendId = node.backendDOMNodeId ?? 0;
    const elementId = `${frameOrdinal}-${backendId}`;
    const urlProp = node.properties?.find((p) => p.name === "url");
    const url = urlProp?.value?.value;

    if (url && typeof url === "string") {
      if (node.role.value === "image" || node.role.value === "img") {
        result.imageMap.set(elementId, url);
      } else {
        result.urlMap.set(elementId, url);
      }
    }
  }
}

/**
 * Resolve image src URLs from the DOM for image nodes that don't have a
 * url property in the AX tree. Many content images only expose their src
 * via the DOM, not through accessibility properties.
 */
export async function resolveImageSrcsFromDOM(
  result: SnapshotResult,
  axNodes: { nodeId: string; backendDOMNodeId?: number; role: { value: string }; properties?: { name: string; value: { value?: string } }[] }[],
  frameOrdinal: number,
  page: Page
): Promise<void> {
  // Collect image nodes that don't already have a URL in imageMap
  const missingImages: { elementId: string; backendNodeId: number }[] = [];
  for (const node of axNodes) {
    if (node.role.value !== "image" && node.role.value !== "img") continue;
    const backendId = node.backendDOMNodeId;
    if (!backendId) continue;
    const elementId = `${frameOrdinal}-${backendId}`;
    if (result.imageMap.has(elementId)) continue;
    missingImages.push({ elementId, backendNodeId: backendId });
  }

  if (missingImages.length === 0) return;

  const cdp = await page.context().newCDPSession(page);
  try {
    for (const { elementId, backendNodeId } of missingImages) {
      try {
        const { object } = await cdp.send("DOM.resolveNode", { backendNodeId });
        if (!object.objectId) continue;
        const { result: srcResult } = await cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: `function() { return this.currentSrc || this.src || ""; }`,
          returnByValue: true,
        });
        const src = srcResult.value;
        if (src && typeof src === "string" && src.startsWith("http")) {
          result.imageMap.set(elementId, src);
        }
      } catch {
        // Node may have been removed from DOM, skip
      }
    }
  } finally {
    await cdp.detach();
  }
}
