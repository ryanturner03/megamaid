// src/cli/commands/chunk.ts
import { Command } from "commander";
import { chunkMarkdown } from "../../core/output/chunker.js";
import { createChunkManifest, addPageToManifest, serializeManifest } from "../../core/output/chunksManifest.js";
import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import path from "path";
import type { ChunkConfig } from "../../types/index.js";

export function createChunkCommand(): Command {
  const cmd = new Command("chunk")
    .description("Chunk existing extracted markdown files for RAG pipelines")
    .argument("<dir>", "Directory containing extracted .md files")
    .option("--chunk-size <chars>", "Target chunk size in characters", "50000")
    .option("--chunk-overlap <n>", "Overlap between chunks in characters", "1000")
    .option("--no-heading-split", "Disable heading-aware splitting")
    .action(async (dir: string, opts) => {
      try {
        const resolvedDir = path.resolve(dir);
        const config: ChunkConfig = {
          chunkSize: parseInt(opts.chunkSize),
          overlap: parseInt(opts.chunkOverlap),
          splitOnHeadings: opts.headingSplit !== false,
        };

        // Find all .md files (skip index.md and chunks/)
        const files = await readdir(resolvedDir);
        const mdFiles = files.filter(
          (f) => f.endsWith(".md") && f !== "index.md"
        );

        if (mdFiles.length === 0) {
          console.error(`No markdown files found in ${resolvedDir}`);
          process.exit(1);
        }

        const chunksDir = path.join(resolvedDir, "chunks");
        await mkdir(chunksDir, { recursive: true });

        const manifest = createChunkManifest(config);
        let totalChunks = 0;

        for (const file of mdFiles) {
          const filePath = path.join(resolvedDir, file);
          const markdown = await readFile(filePath, "utf-8");
          const pageName = file.replace(/\.md$/, "");

          // Try to extract title and source URL from the markdown
          const titleMatch = markdown.match(/^#\s+(.+)$/m);
          const title = titleMatch ? titleMatch[1] : pageName;

          // Check for source_url in frontmatter if present
          const urlMatch = markdown.match(/^source_url:\s*(.+)$/m);
          const url = urlMatch ? urlMatch[1].trim() : "";

          const chunks = chunkMarkdown(markdown, config);

          if (chunks.length <= 1) {
            console.log(`  ${file}: ${markdown.length} chars → 1 chunk (no split needed)`);
            continue;
          }

          const chunkFiles: string[] = [];

          for (const chunk of chunks) {
            const filename = `${pageName}-${String(chunk.index + 1).padStart(3, "0")}.md`;
            const chunkPath = path.join(chunksDir, filename);

            const frontmatter = [
              "---",
              url ? `source_url: ${url}` : null,
              `source_title: "${title.replace(/"/g, '\\"')}"`,
              `chunk: ${chunk.index + 1}`,
              `total_chunks: ${chunks.length}`,
              `heading_context: "${chunk.headingContext.replace(/"/g, '\\"')}"`,
              `chunked_at: ${new Date().toISOString()}`,
              "---",
              "",
            ].filter(Boolean).join("\n");

            await writeFile(chunkPath, frontmatter + chunk.text + "\n", "utf-8");
            chunkFiles.push(path.join("chunks", filename));
          }

          addPageToManifest(manifest, url, title, chunkFiles);

          totalChunks += chunks.length;
          console.log(`  ${file}: ${markdown.length} chars → ${chunks.length} chunks`);
        }

        // Write manifest
        const manifestPath = path.join(resolvedDir, "chunks-manifest.json");
        await writeFile(manifestPath, serializeManifest(manifest), "utf-8");

        console.log(`\nDone. ${totalChunks} chunks from ${mdFiles.length} files.`);
        console.log(`Chunks saved to ${chunksDir}/`);
        console.log(`Manifest saved to ${manifestPath}`);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
