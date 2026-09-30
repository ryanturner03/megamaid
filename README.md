# megamaid

**"She's gone from suck to blow!"**

Extract documentation from any website as clean Markdown. Uses Playwright to capture accessibility tree snapshots, then converts to Markdown via a site-specific Python converter.

## How It Works

```
1. megamaid suck     Crawl/snapshot pages → AX tree JSON + images
2. megamaid analyze  Claude reads samples, writes converter.py
3. megamaid blow     Run converter.py → clean Markdown
```

The key insight: Claude is used **once per site** (to write the converter), not once per page. This makes extraction fast, cheap, and deterministic after the initial analysis.

## Quick Start

```bash
# Install
git clone <repo> && cd megamaid
npm install
npx playwright install chromium
npm run build

# Snapshot a single page
megamaid suck https://docs.example.com/getting-started

# Crawl a docs section (--match auto-derived from URL path)
megamaid suck --crawl https://docs.example.com/api --max-pages 50

# In Claude Code, generate a converter
megamaid analyze ./output

# Convert snapshots to Markdown
megamaid blow ./output
```

## Prerequisites

- **Node.js 20+**
- **Python 3** (for running converter.py)
- **Claude Code** (for the megamaid analyze skill that writes converter.py)

## Commands

### `megamaid suck` -- Capture AX tree snapshots

Navigates to pages via a real browser, captures the accessibility tree (not raw HTML), downloads images, and writes snapshot JSON files to disk.

```bash
# Single page
megamaid suck https://example.com/docs/getting-started

# Multiple pages
megamaid suck https://example.com/page-1 https://example.com/page-2

# From a URL list file
megamaid suck --urls ./my-urls.txt

# Crawl mode (auto-derives --match from URL path)
megamaid suck --crawl https://docs.example.com/api --max-pages 100

# Crawl with explicit match pattern
megamaid suck --crawl https://docs.example.com/api --match "/api/**"

# Resume an interrupted crawl
megamaid suck --crawl https://docs.example.com/api --resume
megamaid suck --crawl https://docs.example.com/api --resume --retry-failed

# With authentication
megamaid suck --session entra --crawl https://internal.example.com/docs
```

#### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--urls <file>` | Read URLs from a file (one per line, # comments allowed) | |
| `--out <dir>` | Output directory | `$MEGAMAID_SUCK_OUT` or `./output` |
| `--crawl <url>` | BFS crawl from this URL, discovering same-origin links | |
| `--match <pattern>` | Glob pattern for crawl URL filtering (auto-derived from --crawl URL if omitted) | |
| `--max-pages <n>` | Stop crawling after this many pages | 100 |
| `--resume` | Resume a previously interrupted crawl | |
| `--retry-failed` | When resuming, also retry previously failed URLs | |
| `--selector <sel>` | CSS/XPath selector to scope snapshot to a page region | full page |
| `--min-image-size <bytes>` | Skip images smaller than this in bytes (0 to disable) | 0 |
| `--min-image-dim <pixels>` | Skip images where both dimensions are below this (filters icons/spacers) | 150 |
| `--skip-svg` | Skip all SVG images (theme icons, logos) | off |
| `--concurrency <n>` | Max parallel page snapshots | 3 |
| `--cdp-url <url>` | Connect to an already-running Chrome via CDP | launches headless |
| `--proxy <url>` | Route traffic through proxy (http:// or socks5://) | |
| `--headed` | Show the browser window | headless |
| `--session [name]` | Load a saved browser session | |
| `--cookies-env <var>` | Read cookies JSON array from this env var (for containers) | |
| `--site-config <name\|path>` | Site config with preActions for login/interstitials | |

#### Crawl Behavior

`--crawl` sets the BFS starting page. `--match` filters which discovered links get queued.

When `--match` is omitted, it is auto-derived from the crawl URL path:
```bash
megamaid suck --crawl https://example.com/docs
# equivalent to: --crawl https://example.com/docs --match "/docs/**"
```

Start the crawl within or near the target path. If you start at the site root but match a deep path, the crawler may never discover matching pages because intermediate links are filtered out.

To crawl an entire site with no filtering, pass `--match "/**"` explicitly.

### `megamaid analyze` -- Generate a converter with Claude

Shells out to `claude -p` with the snapshot analysis instructions baked in. No Claude Code interactive session required — works headless in containers.

```bash
megamaid analyze ./output
megamaid analyze ./output --model sonnet
megamaid analyze ./output --print-prompt  # see what gets sent to Claude
```

Claude reads the site manifest and sample snapshots, analyzes the tree structure, and writes a `converter.py` script tailored to the site. The converter handles:
- Tree parsing and text extraction
- Heading hierarchy
- Link resolution (element IDs → real URLs via urlMap)
- Image embedding (element IDs → local paths via imageMap)
- List formatting
- Code blocks, tables, and other structural elements

### `megamaid blow` -- Convert snapshots to Markdown

Runs the generated `converter.py` against all snapshots to produce Markdown files.

```bash
megamaid blow ./output
megamaid blow ./output --dry-run          # preview one page to stdout
megamaid blow ./output --only page1,page2 # convert specific pages
megamaid blow ./output --out ./markdown   # custom output directory
```

#### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--out <dir>` | Output directory for Markdown files | `$MEGAMAID_BLOW_OUT` or `<dir>/markdown/` |
| `--chunk` | Split output into chunks for RAG pipelines | off |
| `--chunk-size <chars>` | Target chunk size when --chunk is enabled | 50000 |
| `--only <pages>` | Convert only these snapshot names (comma-separated) | all |
| `--dry-run` | Convert one page and print to stdout | |

### `megamaid auth` -- Manage authentication sessions

Capture browser sessions for sites that require login (SSO, OAuth, etc.).

```bash
# Capture a session (opens headed browser for manual login)
megamaid auth https://internal-docs.example.com
megamaid auth --name entra https://login.example.com

# Check if a session is still valid
megamaid auth --check --name entra https://internal-docs.example.com

# List all saved sessions
megamaid auth --list

# Export cookies as JSON (for --cookies-env in containers)
megamaid auth --export-cookies --name internal-docs.example.com

# Clear a saved session
megamaid auth --clear --name entra
```

Sessions are stored in `~/.megamaid/sessions/` with restrictive permissions (0o600).

### `megamaid inspect` -- Debug page capture

Inspect what megamaid sees on a page: accessibility tree, links, and page state.

```bash
megamaid inspect https://example.com/page
megamaid inspect --selector ".content" https://example.com/page
```

### `megamaid chunk` -- Chunk existing Markdown

Split previously extracted Markdown files into chunks for RAG pipelines.

```bash
megamaid chunk ./output
megamaid chunk ./output --chunk-size 50000
```

## Authentication

### Local Usage

```bash
# Save your session (one time, opens headed browser)
megamaid auth https://internal-docs.example.com

# Use it
megamaid suck --session internal-docs.example.com --crawl https://internal-docs.example.com/docs
```

### Containerized / Headless Environments

For running in containers where you can only pass env vars:

**Step 1: Authenticate locally (one time, requires headed browser)**
```bash
megamaid auth https://internal-docs.example.com
# Browser opens → log in via Entra/Okta/etc → select "stay logged in" → close
```

**Step 2: Export cookies as JSON**
```bash
megamaid auth --export-cookies --name internal-docs.example.com > cookies.json
```

The `--name` selects which saved session to export — it does **not** filter cookies. All cookies from the auth session are exported, including SSO domains (e.g. `login.microsoftonline.com`).

**Step 3: Set the env var and run**
```bash
# Inline
MEGAMAID_COOKIES="$(cat cookies.json)" megamaid suck \
  --cookies-env MEGAMAID_COOKIES \
  --crawl https://internal-docs.example.com/docs

# Or export for multiple commands
export MEGAMAID_COOKIES="$(cat cookies.json)"
megamaid suck --cookies-env MEGAMAID_COOKIES --crawl https://internal-docs.example.com/docs
megamaid analyze
megamaid blow
```

**Docker example:**
```bash
docker run \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e MEGAMAID_COOKIES="$(cat cookies.json)" \
  -v ./output:/app/output \
  megamaid suck --cookies-env MEGAMAID_COOKIES --crawl https://internal-docs.example.com/docs
```

**Container requirements:**
- Node.js 20+
- Python 3 (for converter.py)
- Playwright Chromium (`npx playwright install chromium`)
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`) — for `megamaid analyze`
- `ANTHROPIC_API_KEY` env var — for Claude Code headless mode
- `MEGAMAID_COOKIES` env var (optional) — for authenticated sites

This works with Entra SSO, Okta, and other providers. Persistent cookies typically last 90 days. Refresh by re-running steps 1-2 when they expire.

**Note:** Some SSO providers bind sessions to device or IP via conditional access policies. If your org enforces this, cookies from your workstation may not work in a container with a different IP. Check with your IT team or run the container behind the same VPN.

#### Pre-Actions with Environment Variables

Site configs are TOML files stored in `~/.megamaid/sites/<name>.toml` (or `./sites/<name>.toml` relative to the working directory). For sites with simple login forms, use `preActions` with credentials from env vars (`$VAR` and `${VAR}` are interpolated at runtime):

```toml
# ~/.megamaid/sites/internal-docs.toml
name = "internal-docs"
startUrl = "https://internal-docs.example.com/login"

# Optional: URL path patterns to exclude from the crawl queue.
# Any match wins over --match. Matched against URL pathname.
# Patterns are minimatch globs by default; prefix with "re:" for a regex
# escape hatch when globs can't express what you need (e.g. fixed-length
# opaque IDs).
exclude = [
  "/docs/legacy/**",
  "/docs/**/changelog",
  "re:^/r/[A-Za-z0-9_~]{20,24}(/|$)",  # CMS opaque hash URLs
]

[[preActions]]
action = "type"
selector = "#email"
value = "$SITE_USER"

[[preActions]]
action = "type"
selector = "#password"
value = "$SITE_PASS"

[[preActions]]
action = "click"
selector = "button[type=submit]"

[[preActions]]
action = "wait"
selector = "#content"
timeout = 10000
```

```bash
SITE_USER=you@company.com SITE_PASS=secret megamaid suck \
  --site-config internal-docs \
  --crawl https://internal-docs.example.com/docs
```

**Supported `preActions`:**

| Action | Fields | Notes |
|---|---|---|
| `click` | `selector` | |
| `type` | `selector`, `value` | `$VAR` / `${VAR}` interpolated from env |
| `wait` | `selector`, `timeout` (optional, ms) | |
| `delay` | `ms` | Unconditional pause |

## Output Structure

```
output/
  site.json                   # manifest listing all captured pages
  snapshots/
    getting-started.json      # AX tree snapshot per page
    configuration.json
  images/
    getting-started/
      img-001.png             # content images (small icons filtered out)
    configuration/
      img-001.png
  converter.py                # generated by megamaid analyze
  markdown/                   # generated by megamaid blow
    getting-started.md
    configuration.md
```

### Redirected URLs

Some sites serve one page at several URLs and redirect them all to one canonical URL (e.g. a help centre that redirects `/articles/<id>` and stale slugs to `/articles/<id>-<slug>`). During a crawl, a page is recorded under the URL it landed on when that URL is in scope (same origin as the start URL, matches `match`, not excluded): the snapshot's `url` is the landed URL and `requestedUrl` holds the URL that redirected there. Later URLs that redirect to an already-captured page are marked done without writing another snapshot. Redirects out of scope, such as to a sign-in page after a session expires, leave the page under its requested URL.

## Crawl State & Resume

Long-running crawls save progress after every page — both during URL discovery and during snapshotting. If interrupted (crash, auth expiry, network issue), resume from where you left off:

```bash
# Start a crawl
megamaid suck --crawl https://example.com/docs --max-pages 500 --out ./output

# If interrupted, resume
megamaid suck --crawl https://example.com/docs --out ./output --resume

# Resume and retry pages that failed last time
megamaid suck --crawl https://example.com/docs --out ./output --resume --retry-failed
```

State is saved to `.megamaid-state.json` in the output directory and automatically cleaned up when a crawl completes.

## Anti-Bot Detection

megamaid uses a layered stealth approach:

| Layer | Techniques |
|-------|-----------|
| **Fingerprint** | `navigator.webdriver=false`, Chrome runtime injection, plugins/mimeTypes, WebGL vendor spoofing, canvas noise, AudioContext defense |
| **HTTP** | Realistic `Sec-CH-UA` client hints, `Accept`/`Accept-Language` headers, referrer chain, proxy support |
| **Behavioral** | 3-8s random delays between pages, human-like scrolling, cookie banner dismissal |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MEGAMAID_SUCK_OUT` | Default output directory for `suck` (overridden by `--out`) |
| `MEGAMAID_BLOW_OUT` | Default output directory for `blow` (overridden by `--out`) |
| `MEGAMAID_DEBUG` | Enable debug logging when set to `1` |

When `MEGAMAID_SUCK_OUT` is set, `blow`'s input `[dir]` argument also defaults to it (so `megamaid blow` with no args reads from the right place).

## Development

```bash
npm test              # unit tests
npx tsc --noEmit      # type check
npm run build         # compile TypeScript

# Debug mode
MEGAMAID_DEBUG=1 megamaid suck ...
```

## License

MIT
