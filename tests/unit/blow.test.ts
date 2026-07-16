import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateBlowDir } from "../../src/cli/commands/blow.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "megamaid-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true });
});

describe("validateBlowDir", () => {
  it("returns error when site.json is missing", async () => {
    const result = await validateBlowDir(tempDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("site.json");
  });

  it("returns error when converter.py is missing", async () => {
    await writeFile(path.join(tempDir, "site.json"), '{"version":1,"pages":[]}');
    const result = await validateBlowDir(tempDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("converter.py");
    expect(result.error).toContain("megamaid analyze");
  });

  it("returns ok when both site.json and converter.py exist", async () => {
    await writeFile(path.join(tempDir, "site.json"), '{"version":1,"pages":[]}');
    await writeFile(path.join(tempDir, "converter.py"), "print('hello')");
    const result = await validateBlowDir(tempDir);
    expect(result.ok).toBe(true);
  });
});
