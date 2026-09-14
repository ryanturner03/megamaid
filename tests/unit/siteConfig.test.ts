// tests/unit/siteConfig.test.ts
import { describe, it, expect } from "vitest";
import path from "path";
import { loadSiteConfig } from "../../src/core/siteConfig.js";

const fixtureDir = path.resolve(__dirname, "../fixtures/sites");

describe("loadSiteConfig", () => {
  it("parses a minimal config with only name", async () => {
    const config = await loadSiteConfig(path.join(fixtureDir, "valid-minimal.toml"));
    expect(config.name).toBe("minimal");
    expect(config.startUrl).toBeUndefined();
    expect(config.preActions).toBeUndefined();
    expect(config.exclude).toBeUndefined();
  });

  it("parses a full config with all fields and preAction variants", async () => {
    const config = await loadSiteConfig(path.join(fixtureDir, "valid-full.toml"));
    expect(config.name).toBe("fulltest");
    expect(config.startUrl).toBe("https://example.com/login");
    expect(config.exclude).toEqual(["/docs/legacy/**", "/docs/**/changelog"]);
    expect(config.match).toEqual(["/docs/{guide,api}/**"]);
    expect(config.preActions).toHaveLength(4);
    expect(config.preActions![0]).toEqual({
      action: "type",
      selector: "input[name='email']",
      value: "user@example.com",
    });
    expect(config.preActions![1]).toEqual({
      action: "click",
      selector: "button.submit",
    });
    expect(config.preActions![2]).toEqual({
      action: "wait",
      selector: ".dashboard",
      timeout: 5000,
    });
    expect(config.preActions![3]).toEqual({
      action: "delay",
      ms: 2000,
    });
  });

  it("parses match as an array of patterns", async () => {
    const config = await loadSiteConfig(path.join(fixtureDir, "valid-match-array.toml"));
    expect(config.match).toEqual(["/category/**", "/product-detail/**"]);
  });

  it("parses preserveQuery", async () => {
    const config = await loadSiteConfig(path.join(fixtureDir, "valid-preserve-query.toml"));
    expect(config.preserveQuery).toBe(true);
  });

  it("leaves preserveQuery undefined when absent", async () => {
    const config = await loadSiteConfig(path.join(fixtureDir, "valid-minimal.toml"));
    expect(config.preserveQuery).toBeUndefined();
  });

  it("throws clear error when preserveQuery is not a boolean", async () => {
    await expect(
      loadSiteConfig(path.join(fixtureDir, "invalid-preserve-query.toml"))
    ).rejects.toThrow(/preserveQuery.*boolean/i);
  });

  it("rejects unknown keys in a preAction, naming the key and the fix", async () => {
    // Top-level keys written after a [[preActions]] block are absorbed into
    // that table by TOML's scoping rules, silently disabling them. This bit
    // a real site config: its `exclude` list never reached the crawler.
    await expect(
      loadSiteConfig(path.join(fixtureDir, "invalid-leaked-key.toml"))
    ).rejects.toThrow(/exclude/);
    await expect(
      loadSiteConfig(path.join(fixtureDir, "invalid-leaked-key.toml"))
    ).rejects.toThrow(/before the first \[\[preActions\]\]/i);
  });

  it("throws clear error when name field is missing", async () => {
    await expect(
      loadSiteConfig(path.join(fixtureDir, "invalid-no-name.toml"))
    ).rejects.toThrow(/name/i);
  });

  it("throws clear error when preAction has invalid action type", async () => {
    await expect(
      loadSiteConfig(path.join(fixtureDir, "invalid-bad-action.toml"))
    ).rejects.toThrow(/action.*jump/i);
  });

  it("throws clear error when file does not exist", async () => {
    await expect(
      loadSiteConfig(path.join(fixtureDir, "nonexistent.toml"))
    ).rejects.toThrow(/not found|ENOENT/i);
  });

  it("throws clear error on malformed TOML syntax", async () => {
    await expect(
      loadSiteConfig(path.join(fixtureDir, "invalid-malformed.toml"))
    ).rejects.toThrow();
  });

  it("parses settleMs", async () => {
    const config = await loadSiteConfig(path.join(fixtureDir, "valid-settle-ms.toml"));
    expect(config.settleMs).toBe(20000);
  });

  it("leaves settleMs undefined when absent, so the default applies", async () => {
    const config = await loadSiteConfig(path.join(fixtureDir, "valid-minimal.toml"));
    expect(config.settleMs).toBeUndefined();
  });

  it("throws clear error when settleMs is negative", async () => {
    await expect(
      loadSiteConfig(path.join(fixtureDir, "invalid-settle-ms.toml"))
    ).rejects.toThrow(/settleMs/i);
  });
});
