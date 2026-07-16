// src/core/output/chunksManifest.ts
import type { ChunkConfig, ChunkManifest } from "../../types/index.js";

export function createChunkManifest(config: ChunkConfig): ChunkManifest {
  return {
    createdAt: new Date().toISOString(),
    chunkConfig: config,
    totalChunks: 0,
    totalPages: 0,
    pages: [],
  };
}

export function addPageToManifest(
  manifest: ChunkManifest,
  url: string,
  title: string,
  chunkFiles: string[]
): void {
  manifest.pages.push({
    url,
    title,
    chunks: chunkFiles.length,
    files: chunkFiles,
  });
  manifest.totalChunks += chunkFiles.length;
  manifest.totalPages += 1;
}

export function serializeManifest(manifest: ChunkManifest): string {
  return JSON.stringify(manifest, null, 2);
}
