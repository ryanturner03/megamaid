// src/core/siteConfig.ts
import { readFile } from "fs/promises";
import { parse as parseToml } from "smol-toml";
import type { SiteConfig, PreAction } from "../types/index.js";

const VALID_ACTIONS = new Set(["click", "type", "wait", "delay"]);

/**
 * Load and validate a site config from a TOML file.
 * Throws a clear error if the file is missing, malformed, or fails validation.
 */
export async function loadSiteConfig(filepath: string): Promise<SiteConfig> {
  let raw: string;
  try {
    raw = await readFile(filepath, "utf-8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new Error(`Site config not found: ${filepath}`);
    }
    throw new Error(`Failed to read site config ${filepath}: ${e.message}`);
  }

  let parsed: any;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    throw new Error(`Invalid TOML in ${filepath}: ${(err as Error).message}`);
  }

  if (typeof parsed.name !== "string" || parsed.name.length === 0) {
    throw new Error(`Site config ${filepath} is missing required field: name`);
  }

  const config: SiteConfig = { name: parsed.name };

  if (parsed.startUrl !== undefined) {
    if (typeof parsed.startUrl !== "string") {
      throw new Error(`Site config ${filepath}: startUrl must be a string`);
    }
    config.startUrl = parsed.startUrl;
  }

  if (parsed.exclude !== undefined) {
    if (!Array.isArray(parsed.exclude) || !parsed.exclude.every((p: unknown) => typeof p === "string")) {
      throw new Error(`Site config ${filepath}: exclude must be an array of strings`);
    }
    config.exclude = parsed.exclude;
  }

  if (parsed.match !== undefined) {
    if (typeof parsed.match === "string") {
      config.match = [parsed.match];
    } else if (Array.isArray(parsed.match) && parsed.match.every((p: unknown) => typeof p === "string")) {
      config.match = parsed.match;
    } else {
      throw new Error(`Site config ${filepath}: match must be a string or array of strings`);
    }
  }

  if (parsed.preActions !== undefined) {
    if (!Array.isArray(parsed.preActions)) {
      throw new Error(`Site config ${filepath}: preActions must be an array`);
    }
    config.preActions = parsed.preActions.map((entry: any, i: number) => validatePreAction(entry, filepath, i));
  }

  return config;
}

function validatePreAction(entry: any, filepath: string, index: number): PreAction {
  if (!entry || typeof entry !== "object") {
    throw new Error(`Site config ${filepath}: preActions[${index}] must be a table`);
  }
  if (!VALID_ACTIONS.has(entry.action)) {
    throw new Error(
      `Site config ${filepath}: preActions[${index}] has invalid action "${entry.action}" (must be click, type, wait, or delay)`
    );
  }
  switch (entry.action) {
    case "click":
      if (typeof entry.selector !== "string") {
        throw new Error(`Site config ${filepath}: preActions[${index}] (click) requires selector`);
      }
      return { action: "click", selector: entry.selector };
    case "type":
      if (typeof entry.selector !== "string" || typeof entry.value !== "string") {
        throw new Error(`Site config ${filepath}: preActions[${index}] (type) requires selector and value`);
      }
      return { action: "type", selector: entry.selector, value: entry.value };
    case "wait":
      if (typeof entry.selector !== "string") {
        throw new Error(`Site config ${filepath}: preActions[${index}] (wait) requires selector`);
      }
      return {
        action: "wait",
        selector: entry.selector,
        ...(typeof entry.timeout === "number" ? { timeout: entry.timeout } : {}),
      };
    case "delay":
      if (typeof entry.ms !== "number") {
        throw new Error(`Site config ${filepath}: preActions[${index}] (delay) requires ms`);
      }
      return { action: "delay", ms: entry.ms };
    default:
      throw new Error(`unreachable`);
  }
}
