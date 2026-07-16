// src/core/snapshot/capture.ts
import type { Page, CDPSession } from "playwright";
import type { AXNode } from "../../types/index.js";

export async function captureAxTree(page: Page): Promise<AXNode[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    return nodes as unknown as AXNode[];
  } finally {
    await cdp.detach();
  }
}

export async function captureAxTreeScoped(
  page: Page,
  selector: string
): Promise<AXNode[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    // Resolve the selector to a backend node ID
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });

    if (!nodeId) {
      throw new Error(`Selector "${selector}" matched no elements on the page.`);
    }

    // Describe node to get backendNodeId
    const { node } = await cdp.send("DOM.describeNode", { nodeId });

    // Get AX tree for just this node
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");

    // Filter to descendants of the target node
    return filterToSubtree(nodes as unknown as AXNode[], node.backendNodeId);
  } finally {
    await cdp.detach();
  }
}

function filterToSubtree(nodes: AXNode[], rootBackendId: number): AXNode[] {
  // Find the AX node matching the backend node ID
  const rootAx = nodes.find((n) => n.backendDOMNodeId === rootBackendId);
  if (!rootAx) return nodes; // fallback to full tree

  // Collect all descendant IDs via BFS
  const included = new Set<string>();
  const queue = [rootAx.nodeId];
  const nodeMap = new Map(nodes.map((n) => [n.nodeId, n]));

  while (queue.length > 0) {
    const id = queue.shift()!;
    included.add(id);
    const node = nodeMap.get(id);
    if (node?.childIds) {
      queue.push(...node.childIds);
    }
  }

  return nodes.filter((n) => included.has(n.nodeId));
}
