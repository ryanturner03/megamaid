import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getSessionDir, getSessionPath, listSessions, clearSession } from "../../src/core/auth.js";
import { mkdir, writeFile, rm, readdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

// Use a temp dir instead of real ~/.megamaid for tests
const TEST_SESSION_DIR = path.join(tmpdir(), "megamaid-test-sessions");

describe("auth utilities", () => {
  beforeEach(async () => {
    await mkdir(TEST_SESSION_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SESSION_DIR, { recursive: true, force: true });
  });

  it("getSessionDir returns default when no override", () => {
    const dir = getSessionDir();
    expect(dir).toContain(".megamaid");
    expect(dir).toContain("sessions");
  });

  it("getSessionDir returns override when provided", () => {
    const dir = getSessionDir("/custom/path");
    expect(dir).toBe("/custom/path");
  });

  it("getSessionPath returns correct path for a hostname", () => {
    const sessionPath = getSessionPath("docs.wiz.io", TEST_SESSION_DIR);
    expect(sessionPath).toBe(path.join(TEST_SESSION_DIR, "docs.wiz.io.json"));
  });

  it("listSessions returns saved sessions", async () => {
    await writeFile(
      path.join(TEST_SESSION_DIR, "docs.wiz.io.json"),
      JSON.stringify({ savedAt: "2026-03-27T10:00:00Z" }),
      { mode: 0o600 }
    );
    await writeFile(
      path.join(TEST_SESSION_DIR, "docs-cortex.paloaltonetworks.com.json"),
      JSON.stringify({ savedAt: "2026-03-27T09:00:00Z" }),
      { mode: 0o600 }
    );

    const sessions = await listSessions(TEST_SESSION_DIR);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.hostname).sort()).toEqual([
      "docs-cortex.paloaltonetworks.com",
      "docs.wiz.io",
    ]);
  });

  it("clearSession removes session file", async () => {
    const sessionFile = path.join(TEST_SESSION_DIR, "docs.wiz.io.json");
    await writeFile(sessionFile, "{}", { mode: 0o600 });

    await clearSession("docs.wiz.io", TEST_SESSION_DIR);

    const files = await readdir(TEST_SESSION_DIR);
    expect(files).not.toContain("docs.wiz.io.json");
  });

  it("listSessions returns empty array when no sessions", async () => {
    const sessions = await listSessions(TEST_SESSION_DIR);
    expect(sessions).toHaveLength(0);
  });

  it("listSessions returns empty array when dir does not exist", async () => {
    const sessions = await listSessions("/nonexistent/path/sessions");
    expect(sessions).toHaveLength(0);
  });
});
