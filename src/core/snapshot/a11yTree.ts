// src/core/snapshot/a11yTree.ts
import type { AXNode, AXProperty, FormattedNode } from "../../types/index.js";

const SKIP_ROLES = new Set(["generic", "none"]);
// InlineTextBox is always a leaf that duplicates its parent StaticText — always skip
const ALWAYS_SKIP_ROLES = new Set(["InlineTextBox"]);

/**
 * Build a formatted tree from raw AX nodes.
 *
 * Instead of pruning nodes from the list (which breaks child promotion
 * across deeply nested structural nodes), we keep the full tree structure
 * and skip non-meaningful nodes during tree building. Children of skipped
 * nodes are naturally promoted to the nearest meaningful ancestor.
 */
export function buildFormattedNodes(
  rawNodes: AXNode[],
  frameOrdinal: number
): FormattedNode {
  const nodeMap = new Map<string, AXNode>();
  for (const node of rawNodes) {
    nodeMap.set(node.nodeId, node);
  }

  function buildNode(axNode: AXNode, depth: number): FormattedNode[] {
    const isIgnored = axNode.ignored?.value === true;
    const isAlwaysSkipped = ALWAYS_SKIP_ROLES.has(axNode.role.value);
    const isStructural = SKIP_ROLES.has(axNode.role.value) && !axNode.name?.value;
    const isRedundantText = isRedundantStaticText(axNode, nodeMap);
    const shouldSkip = isIgnored || isAlwaysSkipped || isStructural || isRedundantText;

    // Recursively process children
    const childResults: FormattedNode[] = [];
    for (const childId of axNode.childIds || []) {
      const childAx = nodeMap.get(childId);
      if (childAx) {
        childResults.push(...buildNode(childAx, shouldSkip ? depth : depth + 1));
      }
    }

    // Skip this node but keep its children (promotion)
    if (shouldSkip) {
      return childResults;
    }

    const backendId = axNode.backendDOMNodeId ?? 0;
    const id = `${frameOrdinal}-${backendId}`;
    const level = getProperty(axNode.properties, "level");

    return [{
      id,
      role: axNode.role.value,
      name: axNode.name?.value || "",
      level: typeof level === "number" ? level : undefined,
      depth,
      children: childResults,
    }];
  }

  const root = rawNodes[0];
  if (!root) {
    return { id: `${frameOrdinal}-0`, role: "empty", name: "", depth: 0, children: [] };
  }

  const results = buildNode(root, 0);
  // If root was skipped (structural), wrap the children
  if (results.length === 0) {
    return { id: `${frameOrdinal}-0`, role: "empty", name: "", depth: 0, children: [] };
  }
  if (results.length === 1) {
    return results[0];
  }
  // Multiple top-level nodes — wrap in a synthetic root
  return {
    id: `${frameOrdinal}-0`,
    role: "document",
    name: "",
    depth: 0,
    children: results,
  };
}

function isRedundantStaticText(node: AXNode, nodeMap: Map<string, AXNode>): boolean {
  if (node.role.value !== "StaticText") return false;
  // Find parent
  for (const [, other] of nodeMap) {
    if (other.childIds?.includes(node.nodeId)) {
      return other.name?.value === node.name?.value;
    }
  }
  return false;
}

function getProperty(
  properties: AXProperty[] | undefined,
  name: string
): string | number | boolean | undefined {
  if (!properties) return undefined;
  const prop = properties.find((p) => p.name === name);
  return prop?.value?.value;
}

/**
 * @deprecated Use buildFormattedNodes directly — pruning is now integrated.
 */
export function pruneAxTree(nodes: AXNode[]): AXNode[] {
  return nodes;
}
