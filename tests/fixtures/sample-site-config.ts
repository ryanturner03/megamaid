import { z } from "zod";

const docPage = z.object({
  title: z.string().describe("Documentation page title"),
  body: z.string().describe("Documentation content as Markdown"),
});

const apiRef = z.object({
  title: z.string().describe("API reference title"),
  endpoint: z.string().describe("API endpoint path"),
  body: z.string().describe("API reference content as Markdown"),
});

export default {
  name: "docs-cortex.paloaltonetworks.com",
  schemas: [
    {
      match: "/r/Cortex-XSIAM/Cortex-XSIAM-API-Reference/**",
      schema: apiRef,
      description: "API reference page with endpoint details",
    },
    {
      match: "/r/Cortex-XSIAM/**",
      schema: docPage,
      description: "General documentation page with title and body",
    },
  ],
};
