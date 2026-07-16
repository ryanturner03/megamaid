// tests/fixtures/sample-schema.ts
import { z } from "zod";

export default z.object({
  title: z.string().describe("Page title"),
  body: z.string().describe("Main content as Markdown"),
  link: z.string().url().describe("A URL on the page"),
});
