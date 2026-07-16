// src/core/auth.ts
import { chromium } from "playwright";
import { writeFile, readFile, readdir, unlink, mkdir, stat } from "fs/promises";
import { homedir } from "os";
import path from "path";

export interface SessionInfo {
  hostname: string;
  savedAt: string;
  storagePath: string;
}

const DEFAULT_SESSION_DIR = path.join(homedir(), ".megamaid", "sessions");

export function getSessionDir(overrideDir?: string): string {
  return overrideDir ?? DEFAULT_SESSION_DIR;
}

export function getSessionPath(name: string, sessionDir?: string): string {
  return path.join(getSessionDir(sessionDir), `${name}.json`);
}

export function hostnameFromUrl(url: string): string {
  return new URL(url).hostname;
}

/**
 * Open a headed browser for the user to log in manually.
 * Captures storageState after user confirms login, saves to disk.
 * If `name` is provided, the session is saved under that name instead of the hostname.
 */
export async function captureSession(
  url?: string,
  opts?: { name?: string; sessionDir?: string }
): Promise<SessionInfo> {
  const dir = getSessionDir(opts?.sessionDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const sessionName = opts?.name ?? (url ? hostnameFromUrl(url) : undefined);
  if (!sessionName) {
    throw new Error("Either a URL or --name is required to save a session.");
  }

  // Launch HEADED browser (user needs to interact)
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  // Wait for user to signal they've logged in
  console.log("\n  Browser opened. Log in to the site.");
  console.log("  When you're logged in, press Enter here.\n");

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  // Capture session
  const storageState = await context.storageState();
  const storagePath = getSessionPath(sessionName, opts?.sessionDir);

  await writeFile(storagePath, JSON.stringify(storageState, null, 2), {
    mode: 0o600,
  });

  await browser.close();

  return {
    hostname: sessionName,
    savedAt: new Date().toISOString(),
    storagePath,
  };
}

/**
 * Load a saved session by name or hostname. Returns the path if it exists.
 * Tries the given name first (for named profiles like "entra"),
 * then falls back to treating it as a hostname.
 */
export async function loadSession(
  nameOrHostname: string,
  sessionDir?: string
): Promise<string | null> {
  // Try exact name first
  const sessionPath = getSessionPath(nameOrHostname, sessionDir);
  try {
    await stat(sessionPath);
    return sessionPath;
  } catch {
    // Not found by name
  }

  // If it looks like a hostname (contains dots), no further fallback needed
  // If it doesn't contain dots, it was a profile name that doesn't exist
  return null;
}

/**
 * Validate a saved session by navigating to the URL and checking
 * for login redirects. Accepts a URL and optional session name.
 */
export async function validateSession(
  url: string,
  opts?: { name?: string; sessionDir?: string }
): Promise<boolean> {
  const hostname = hostnameFromUrl(url);
  const sessionPath = await loadSession(opts?.name ?? hostname, opts?.sessionDir);
  if (!sessionPath) return false;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: sessionPath,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Check if we got redirected to a login page
    const finalUrl = page.url();
    const finalHostname = new URL(finalUrl).hostname;
    const title = (await page.title()).toLowerCase();

    // Heuristic: if hostname changed or title contains login keywords, session is invalid
    if (finalHostname !== hostname) return false;
    if (title.includes("sign in") || title.includes("log in") || title.includes("sso") || title.includes("authenticate")) {
      return false;
    }

    return true;
  } catch {
    return false;
  } finally {
    await browser.close();
  }
}

/**
 * Delete a saved session.
 */
export async function clearSession(
  hostname: string,
  sessionDir?: string
): Promise<void> {
  const sessionPath = getSessionPath(hostname, sessionDir);
  try {
    // Overwrite before delete for security
    await writeFile(sessionPath, Buffer.alloc(256, 0));
    await unlink(sessionPath);
  } catch {
    // File doesn't exist
  }
}

/**
 * List all saved sessions.
 */
export async function listSessions(sessionDir?: string): Promise<SessionInfo[]> {
  const dir = getSessionDir(sessionDir);
  try {
    const files = await readdir(dir);
    const sessions: SessionInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const hostname = file.replace(/\.json$/, "");
      const filePath = path.join(dir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const data = JSON.parse(content);
        sessions.push({
          hostname,
          savedAt: data.savedAt ?? "unknown",
          storagePath: filePath,
        });
      } catch {
        sessions.push({ hostname, savedAt: "unknown", storagePath: filePath });
      }
    }

    return sessions;
  } catch {
    return [];
  }
}
