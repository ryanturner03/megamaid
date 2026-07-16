// src/core/output/chunker.ts
import type { ChunkConfig, TextChunk } from "../../types/index.js";

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/m;

interface Section {
  heading: string;
  level: number;
  text: string;
  startPos: number;
  endPos: number;
}

export function chunkMarkdown(markdown: string, config: ChunkConfig): TextChunk[] {
  if (markdown.length <= config.chunkSize) {
    return [{
      text: markdown,
      index: 0,
      startPos: 0,
      endPos: markdown.length,
      headingContext: extractFirstHeading(markdown),
    }];
  }

  if (!config.splitOnHeadings) {
    return chunkByCharacter(markdown, config);
  }

  // Parse into sections by heading
  const sections = parseSections(markdown);

  // Group sections into chunks respecting chunkSize
  const chunks: TextChunk[] = [];
  let currentText = "";
  let currentStart = sections[0]?.startPos ?? 0;
  let headingStack: string[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    // Update heading stack based on level
    updateHeadingStack(headingStack, section.heading, section.level);

    if (currentText.length + section.text.length > config.chunkSize && currentText.length > 0) {
      // Emit current chunk
      chunks.push({
        text: currentText.trim(),
        index: chunks.length,
        startPos: currentStart,
        endPos: currentStart + currentText.length,
        headingContext: buildHeadingContext(headingStack),
      });

      // Start new chunk with overlap
      const overlapText = getOverlapText(currentText, config.overlap);
      currentText = overlapText + section.text;
      currentStart = section.startPos - overlapText.length;
    } else {
      currentText += section.text;
    }

    // If a single section exceeds chunkSize, split it by character
    if (currentText.length > config.chunkSize * 1.5) {
      const subChunks = chunkByCharacter(currentText, config);
      for (const sub of subChunks) {
        chunks.push({
          text: sub.text.trim(),
          index: chunks.length,
          startPos: currentStart + sub.startPos,
          endPos: currentStart + sub.endPos,
          headingContext: buildHeadingContext(headingStack),
        });
      }
      currentText = "";
      currentStart = section.endPos;
    }
  }

  // Emit remaining text
  if (currentText.trim().length > 0) {
    chunks.push({
      text: currentText.trim(),
      index: chunks.length,
      startPos: currentStart,
      endPos: currentStart + currentText.length,
      headingContext: buildHeadingContext(headingStack),
    });
  }

  // Reindex
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].index = i;
  }

  return chunks;
}

function parseSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let pos = 0;

  for (const line of lines) {
    const headingMatch = line.match(HEADING_REGEX);

    if (headingMatch) {
      if (currentSection) {
        currentSection.endPos = pos;
        sections.push(currentSection);
      }
      currentSection = {
        heading: headingMatch[2],
        level: headingMatch[1].length,
        text: line + "\n",
        startPos: pos,
        endPos: pos,
      };
    } else if (currentSection) {
      currentSection.text += line + "\n";
    } else {
      // Content before first heading
      currentSection = {
        heading: "",
        level: 0,
        text: line + "\n",
        startPos: pos,
        endPos: pos,
      };
    }

    pos += line.length + 1;
  }

  if (currentSection) {
    currentSection.endPos = pos;
    sections.push(currentSection);
  }

  return sections;
}

function chunkByCharacter(text: string, config: ChunkConfig): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + config.chunkSize, text.length);

    // If not at the end, find a good break point
    if (end < text.length) {
      const segment = text.substring(start, end);
      const breakPoint = findBreakPoint(segment);
      if (breakPoint > config.chunkSize * 0.3) {
        end = start + breakPoint;
      }
    }

    chunks.push({
      text: text.substring(start, end),
      index: chunks.length,
      startPos: start,
      endPos: end,
      headingContext: extractFirstHeading(text.substring(start, end)),
    });

    const nextStart = Math.max(end - config.overlap, start + 1);
    if (nextStart >= text.length) break;
    start = nextStart;
  }

  return chunks;
}

function findBreakPoint(text: string): number {
  // Prefer: sentence end > paragraph break > newline > word boundary
  const sentenceEnd = text.lastIndexOf(". ");
  if (sentenceEnd > text.length * 0.5) return sentenceEnd + 2;

  const paragraphBreak = text.lastIndexOf("\n\n");
  if (paragraphBreak > text.length * 0.3) return paragraphBreak + 2;

  const newline = text.lastIndexOf("\n");
  if (newline > text.length * 0.3) return newline + 1;

  const space = text.lastIndexOf(" ");
  if (space > text.length * 0.3) return space + 1;

  return text.length;
}

function getOverlapText(text: string, overlap: number): string {
  if (text.length <= overlap) return text;
  const start = text.length - overlap;
  // Snap to nearest newline within overlap range
  const newline = text.indexOf("\n", start);
  if (newline >= 0 && newline < text.length) {
    return text.substring(newline + 1);
  }
  return text.substring(start);
}

function updateHeadingStack(stack: string[], heading: string, level: number): void {
  if (!heading) return;
  // Remove headings at same or deeper level
  while (stack.length >= level) {
    stack.pop();
  }
  stack.push(heading);
}

function buildHeadingContext(stack: string[]): string {
  return stack.filter(Boolean).join(" > ");
}

function extractFirstHeading(text: string): string {
  const match = text.match(HEADING_REGEX);
  return match ? match[2] : "";
}
