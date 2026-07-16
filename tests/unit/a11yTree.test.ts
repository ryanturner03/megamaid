// tests/unit/a11yTree.test.ts
import { describe, it, expect } from "vitest";
import { buildFormattedNodes } from "../../src/core/snapshot/a11yTree.js";
import type { AXNode, FormattedNode } from "../../src/types/index.js";
import sampleTree from "../fixtures/sample-ax-tree.json";

const nodes = sampleTree.nodes as AXNode[];

describe("buildFormattedNodes", () => {
  it("builds tree with correct element IDs", () => {
    const formatted = buildFormattedNodes(nodes, 0);
    expect(formatted.id).toBe("0-1");
    expect(formatted.role).toBe("RootWebArea");
    expect(formatted.name).toBe("Test Page");
  });

  it("skips ignored nodes", () => {
    const formatted = buildFormattedNodes(nodes, 0);
    const allIds = collectIds(formatted);
    expect(allIds).not.toContain("0-100");
  });

  it("skips structural-only nodes but keeps their children", () => {
    // Build a mini tree where structural node is part of the hierarchy
    const testNodes: AXNode[] = [
      { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Test" }, backendDOMNodeId: 1, childIds: ["2"], ignored: { value: false } },
      { nodeId: "2", role: { value: "generic" }, name: undefined, backendDOMNodeId: 2, childIds: ["3"], ignored: { value: false } },
      { nodeId: "3", role: { value: "heading" }, name: { value: "Hello" }, backendDOMNodeId: 3, childIds: [], ignored: { value: false }, properties: [{ name: "level", value: { type: "integer", value: 1 } }] },
    ];
    const formatted = buildFormattedNodes(testNodes, 0);
    const allIds = collectIds(formatted);
    expect(allIds).not.toContain("0-2"); // generic skipped
    expect(allIds).toContain("0-3");     // heading promoted
  });

  it("skips 'none' role nodes", () => {
    const formatted = buildFormattedNodes(nodes, 0);
    const allRoles = collectRoles(formatted);
    expect(allRoles).not.toContain("none");
  });

  it("attaches heading level from properties", () => {
    const formatted = buildFormattedNodes(nodes, 0);
    const heading = findNode(formatted, "0-37");
    expect(heading).toBeDefined();
    expect(heading!.level).toBe(1);
  });

  it("keeps meaningful nodes like headings and links", () => {
    const formatted = buildFormattedNodes(nodes, 0);
    const allIds = collectIds(formatted);
    // These are children of root in the fixture
    expect(allIds).toContain("0-37");  // heading
    expect(allIds).toContain("0-70");  // link
  });
});

function collectIds(node: FormattedNode): string[] {
  const ids = [node.id];
  for (const child of node.children) ids.push(...collectIds(child));
  return ids;
}

function collectRoles(node: FormattedNode): string[] {
  const roles = [node.role];
  for (const child of node.children) roles.push(...collectRoles(child));
  return roles;
}

function findNode(node: FormattedNode, id: string): FormattedNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}
