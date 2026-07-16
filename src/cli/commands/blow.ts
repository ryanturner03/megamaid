// src/cli/commands/blow.ts
import { Command } from "commander";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

export interface ValidateResult {
  ok: boolean;
  error?: string;
}

export async function validateBlowDir(dir: string): Promise<ValidateResult> {
  const sitePath = path.join(dir, "site.json");
  if (!existsSync(sitePath)) {
    return { ok: false, error: `No site.json found in ${dir}. Run megamaid suck first.` };
  }

  const converterPath = path.join(dir, "converter.py");
  if (!existsSync(converterPath)) {
    return {
      ok: false,
      error: `No converter.py found in ${dir}. Run 'megamaid analyze' first.`,
    };
  }

  return { ok: true };
}

export function createBlowCommand(): Command {
  const cmd = new Command("blow")
    .description("Run converter.py against snapshots to produce clean Markdown")
    .addHelpText("after", `
Prerequisites:
  1. Run 'megamaid suck' to capture snapshots into a directory
  2. Run megamaid analyze in Claude Code to generate converter.py in that directory
  3. Run 'megamaid blow <dir>' to convert all snapshots to Markdown

  The <dir> must contain both site.json (from suck) and converter.py (from
  megamaid analyze). Requires Python 3.

Examples:
  megamaid blow ./output
  megamaid blow ./output --dry-run          # preview one page to stdout
  megamaid blow ./output --only page1,page2 # convert specific pages
  megamaid blow ./output --out ./markdown   # custom output directory
`)
    .argument("[dir]", "Directory containing site.json and converter.py (output of suck + megamaid analyze)", process.env.MEGAMAID_SUCK_OUT ?? "./output")
    .option("--out <dir>", "Output directory for Markdown files (default: <dir>/markdown/)", process.env.MEGAMAID_BLOW_OUT)
    .option("--chunk", "Split output into chunks sized for RAG pipelines")
    .option("--chunk-size <chars>", "Target chunk size in characters when --chunk is enabled", "50000")
    .option("--only <pages>", "Convert only these snapshot names (comma-separated)")
    .option("--dry-run", "Convert one page and print to stdout instead of writing files")
    .action(async (dir: string, opts) => {
      try {
        const inputDir = path.resolve(dir);

        const validation = await validateBlowDir(inputDir);
        if (!validation.ok) {
          console.error(validation.error);
          process.exit(1);
        }

        const pythonAvailable = await checkPython();
        if (!pythonAvailable) {
          console.error("Python 3 is required for conversion. Install it or run converter.py manually.");
          process.exit(1);
        }

        const converterPath = path.join(inputDir, "converter.py");
        const args = [converterPath, inputDir];

        if (opts.out) {
          args.push("--out", path.resolve(opts.out));
        }
        if (opts.chunk) {
          args.push("--chunk");
          args.push("--chunk-size", opts.chunkSize);
        }
        if (opts.only) {
          args.push("--only", opts.only);
        }
        if (opts.dryRun) {
          args.push("--dry-run");
        }

        const siteJson = JSON.parse(await readFile(path.join(inputDir, "site.json"), "utf-8"));
        const pageCount = siteJson.pages?.length ?? 0;
        console.log(`Running converter on ${pageCount} pages...`);

        const exitCode = await runPython(args);

        if (exitCode !== 0) {
          console.error(`\nConverter exited with code ${exitCode}.`);
          process.exit(1);
        }

        if (!opts.dryRun) {
          const outDir = opts.out ?? path.join(inputDir, "markdown");
          console.log(`\nDone. Markdown written to ${outDir}/`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}

async function checkPython(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("python3", ["--version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

function runPython(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.on("error", (err) => reject(new Error(`Failed to start Python: ${err.message}`)));
    proc.on("close", (code) => resolve(code ?? 1));
  });
}
