// src/cli/commands/auth.ts
import { Command } from "commander";
import {
  captureSession,
  validateSession,
  clearSession,
  listSessions,
  hostnameFromUrl,
} from "../../core/auth.js";

export function createAuthCommand(): Command {
  const cmd = new Command("auth")
    .description("Manage authentication sessions for target sites")
    .argument("[url]", "Target site URL for login")
    .option("--name <name>", "Save/load session under a custom profile name (e.g. 'entra')")
    .option("--session <name>", "Alias for --name")
    .option("--check", "Open a headed browser with saved session to verify it works (no URL needed)")
    .option("--clear", "Delete saved session for a site or profile name")
    .option("--list", "Show all saved sessions")
    .option("--export-cookies", "Print session cookies as JSON (for --cookies-env in containers)")
    .action(async (url: string | undefined, opts) => {
      try {
        if (opts.list) {
          const sessions = await listSessions();
          if (sessions.length === 0) {
            console.log("No saved sessions.");
            return;
          }
          console.log("Saved sessions:\n");
          for (const s of sessions) {
            console.log(`  ${s.hostname}`);
            console.log(`    Saved: ${s.savedAt}`);
            console.log(`    Path: ${s.storagePath}\n`);
          }
          return;
        }

        // --session is an alias for --name
        const name = opts.name ?? opts.session;

        if (!url && !name) {
          console.error("URL or --name/--session required. Usage: megamaid auth <url> or megamaid auth --session <name>");
          process.exit(1);
        }

        const label = name ?? hostnameFromUrl(url!);

        if (opts.clear) {
          await clearSession(label);
          console.log(`Session cleared for ${label}`);
          return;
        }

        if (opts.exportCookies) {
          const { loadSession } = await import("../../core/auth.js");
          const sessionPath = await loadSession(label);
          if (!sessionPath) {
            console.error(`No saved session for ${label}. Run 'megamaid auth <url>' first.`);
            process.exit(1);
          }
          const { readFile } = await import("fs/promises");
          const state = JSON.parse(await readFile(sessionPath, "utf-8"));
          const cookies = state.cookies ?? [];
          console.log(JSON.stringify(cookies));
          return;
        }

        if (opts.check) {
          const { loadSession } = await import("../../core/auth.js");
          const sessionPath = await loadSession(label);
          if (!sessionPath) {
            console.error(`No saved session for ${label}. Run 'megamaid auth <url>' first.`);
            process.exit(1);
          }
          const { connectBrowser, closeBrowser } = await import("../../core/browser.js");
          console.log(`Opening headed browser with session "${label}"...`);
          console.log(`Navigate around to verify your session. Close the browser when done.\n`);
          const conn = await connectBrowser({ sessionPath, headless: false });
          if (url) {
            await conn.page.goto(url, { waitUntil: "domcontentloaded" });
          }
          // Wait for the browser to close
          await new Promise<void>((resolve) => {
            conn.browser.on("disconnected", () => resolve());
          });
          console.log("Browser closed.");
          return;
        }

        // Default: capture a new session
        console.log(url ? `Opening browser to ${url}...` : "Opening browser...");
        const session = await captureSession(url, { name: opts.name });
        console.log(`\nSession saved as "${session.hostname}"`);
        console.log(`\nYou can now snapshot with:`);
        console.log(`  megamaid suck --session ${session.hostname} <url>`);
        console.log(`\nTo export cookies for containers:`);
        console.log(`  megamaid auth --export-cookies --name ${session.hostname}`);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
