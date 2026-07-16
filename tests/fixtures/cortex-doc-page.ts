// tests/fixtures/cortex-doc-page.ts
import { z } from "zod";

export default z.object({
  title: z.string().describe("The documentation page title"),
  body: z.string().describe("The full documentation content as Markdown, including all headings, paragraphs, code blocks, lists, and tables"),
});
