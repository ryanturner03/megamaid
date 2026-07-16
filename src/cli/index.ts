#!/usr/bin/env node
import { Command } from "commander";
import { createSuckCommand } from "./commands/suck.js";
import { createBlowCommand } from "./commands/blow.js";
import { createAuthCommand } from "./commands/auth.js";
import { createInspectCommand } from "./commands/inspect.js";
import { createChunkCommand } from "./commands/chunk.js";
import { createAnalyzeCommand } from "./commands/analyze.js";

const program = new Command()
  .name("megamaid")
  .description("She's gone from suck to blow! — Web content extraction as clean Markdown")
  .version("0.1.0")
  .addHelpText("after", `
Workflow:
  1. megamaid suck      Crawl/snapshot pages → AX tree JSON + images
  2. megamaid analyze   Claude reads samples, writes converter.py
  3. megamaid blow      Run converter.py → clean Markdown

Run 'megamaid <command> --help' for detailed usage of each command.
`);

program.addCommand(createSuckCommand());
program.addCommand(createAnalyzeCommand());
program.addCommand(createBlowCommand());
program.addCommand(createInspectCommand());
program.addCommand(createChunkCommand());
program.addCommand(createAuthCommand());

program.parse();
