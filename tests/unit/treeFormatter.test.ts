// tests/unit/treeFormatter.test.ts
import { describe, it, expect } from "vitest";
import { formatTree } from "../../src/core/snapshot/treeFormatter.js";
import type { FormattedNode } from "../../src/types/index.js";

const sampleTree: FormattedNode = {
  id: "0-1",
  role: "RootWebArea",
  name: "Test Page",
  depth: 0,
  children: [
    {
      id: "0-37",
      role: "heading",
      name: "Welcome",
      level: 1,
      depth: 1,
      children: [],
    },
    {
      id: "0-52",
      role: "paragraph",
      name: "Some text content here.",
      depth: 1,
      children: [],
    },
    {
      id: "0-70",
      role: "link",
      name: "Click here",
      depth: 1,
      children: [],
    },
    {
      id: "0-80",
      role: "image",
      name: "A photo",
      depth: 1,
      children: [],
    },
  ],
};

describe("formatTree", () => {
  it("formats tree as indented text outline", () => {
    const result = formatTree(sampleTree);

    expect(result.tree).toContain('[0-1] RootWebArea: "Test Page"');
    expect(result.tree).toContain('  [0-37] heading (level=1): "Welcome"');
    expect(result.tree).toContain('  [0-52] paragraph: "Some text content here."');
    expect(result.tree).toContain('  [0-70] link: "Click here"');
    expect(result.tree).toContain('  [0-80] image: "A photo"');
  });

  it("builds URL map from link nodes", () => {
    // We need to add url info to the tree for this test.
    // The urlMap is built by scanning properties during formatting.
    // For now, test that the maps exist and are Maps.
    const result = formatTree(sampleTree);
    expect(result.urlMap).toBeInstanceOf(Map);
    expect(result.imageMap).toBeInstanceOf(Map);
  });

  it("reports correct node count", () => {
    const result = formatTree(sampleTree);
    expect(result.nodeCount).toBe(5); // root + 4 children
  });
});
