// ── AX Tree ──

export interface AXNode {
  nodeId: string;
  role: { value: string };
  name?: { value: string };
  description?: { value: string };
  properties?: AXProperty[];
  childIds?: string[];
  backendDOMNodeId?: number;
  frameId?: string;
  ignored?: { value: boolean };
}

export interface AXProperty {
  name: string;
  value: { type: string; value?: string | number | boolean };
}

export interface FormattedNode {
  id: string; // "frameOrdinal-backendNodeId"
  role: string;
  name: string;
  level?: number;
  depth: number;
  children: FormattedNode[];
}

export interface SnapshotResult {
  tree: string; // formatted text outline
  urlMap: Map<string, string>; // elementId → URL
  imageMap: Map<string, string>; // elementId → image src URL
  nodeCount: number;
}

// ── Snapshot Files (suck/blow pipeline) ──

export interface SnapshotFile {
  version: 1;
  url: string;
  /** The URL that was requested, when it redirected to `url`. */
  requestedUrl?: string;
  title: string;
  tree: string;
  urlMap: Record<string, string>;
  imageMap: Record<string, string>;
  nodeCount: number;
  capturedAt: string;
}

export interface SiteManifestPage {
  url: string;
  snapshot: string;
  imageCount: number;
}

export interface SiteManifest {
  version: 1;
  startUrl: string;
  match?: string[];
  pageCount: number;
  totalImages: number;
  siteConfig?: string;
  session?: string;
  startedAt: string;
  completedAt?: string;
  pages: SiteManifestPage[];
}

export interface SiteConfig {
  name: string;
  startUrl?: string;
  preActions?: PreAction[];
  exclude?: string[];
  match?: string[];
  /** Keep query strings when deduping/queueing links (query-addressed sites). */
  preserveQuery?: boolean;
  /**
   * Extra settle after each page load, in ms, before the snapshot is taken
   * (default 2000). For SPA consoles whose shell renders immediately while the
   * content pane keeps loading: the built-in wait only requires that the body
   * have *some* text, which a nav bar satisfies at once, so the page is
   * captured as an empty shell. Opt-in per site — a large value here multiplies
   * across every page of a crawl.
   */
  settleMs?: number;
}

export type PreAction =
  | { action: "click"; selector: string }
  | { action: "type"; selector: string; value: string }
  | { action: "wait"; selector: string; timeout?: number }
  | { action: "delay"; ms: number };

// ── Crawl State Persistence ──

export interface CrawlState {
  version: 1;
  startUrl: string;
  match?: string[];
  discoveredUrls: string[];
  completedUrls: string[];
  failedUrls: string[];
  excludedUrls: string[];
  queue: string[];
  /** Requested URL → in-scope URL it redirected to (and was recorded under). */
  redirects?: Record<string, string>;
  startedAt: string;
  updatedAt: string;
  config: {
    selector?: string;
    siteConfig?: string;
    session?: string;
    exclude?: string[];
    preserveQuery?: boolean;
  };
}

export interface CrawlStateInfo {
  pagesCompleted: number;
  pagesRemaining: number;
  pagesFailed: number;
  pagesExcluded: number;
  lastUpdated: string;
  startUrl: string;
}

// ── RAG Chunking ──

export interface ChunkConfig {
  chunkSize: number;         // target chars per chunk (default: 1500)
  overlap: number;           // overlap chars between chunks (default: 200)
  splitOnHeadings: boolean;  // prefer heading boundaries (default: true)
}

export interface TextChunk {
  text: string;
  index: number;
  startPos: number;
  endPos: number;
  headingContext: string;  // nearest parent heading chain, e.g. "## Config > ### Env Vars"
}

export interface ChunkManifestEntry {
  url: string;
  title: string;
  chunks: number;
  files: string[];
}

export interface ChunkManifest {
  createdAt: string;
  chunkConfig: ChunkConfig;
  totalChunks: number;
  totalPages: number;
  pages: ChunkManifestEntry[];
}
