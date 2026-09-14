// src/core/browser.ts
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

export interface BrowserConnection {
  browser: Browser;
  page: Page;
  isManaged: boolean; // true if we launched it (should close on cleanup)
}

export interface CookieParam {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface ConnectOptions {
  cdpUrl?: string;
  headless?: boolean;
  sessionPath?: string;  // path to Playwright storageState JSON
  proxy?: string;        // proxy URL (e.g., http://proxy:8080, socks5://proxy:1080)
  cookies?: CookieParam[];  // cookies to inject before first navigation
}

/**
 * Stealth evasion scripts injected into every page context.
 * These override common bot-detection fingerprints.
 */
const STEALTH_SCRIPTS = `
// 1. Hide navigator.webdriver
Object.defineProperty(navigator, 'webdriver', { get: () => false });

// 2. Add chrome runtime object (missing in headless)
if (!window.chrome) {
  window.chrome = {
    runtime: {
      onMessage: { addListener: function() {}, removeListener: function() {} },
      sendMessage: function() {},
      connect: function() { return { onMessage: { addListener: function() {} } }; }
    },
    loadTimes: function() { return {}; },
    csi: function() { return {}; }
  };
}

// 3. Fix navigator.plugins (empty in headless)
if (navigator.plugins.length === 0) {
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      plugins.refresh = function() {};
      return plugins;
    }
  });
}

// 4. Fix navigator.mimeTypes
if (navigator.mimeTypes.length === 0) {
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => {
      const types = [
        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
      ];
      return types;
    }
  });
}

// 5. Fix permissions query (some sites check this)
const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
if (originalQuery) {
  window.navigator.permissions.query = (parameters) => {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission });
    }
    return originalQuery(parameters);
  };
}

// 6. Fix WebGL vendor/renderer (headless uses SwiftShader)
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) return 'Intel Inc.';
  if (parameter === 37446) return 'Intel Iris OpenGL Engine';
  return getParameter.call(this, parameter);
};

// 7. Canvas fingerprint noise — add subtle random variation
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
  const ctx = this.getContext('2d');
  if (ctx && this.width > 0 && this.height > 0) {
    try {
      const pixel = ctx.getImageData(0, 0, 1, 1);
      pixel.data[0] = pixel.data[0] ^ 1; // flip least significant bit
      ctx.putImageData(pixel, 0, 0);
    } catch(e) {}
  }
  return originalToDataURL.call(this, type, quality);
};

// 8. AudioContext fingerprint
if (window.AudioContext || window.webkitAudioContext) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const origCreateOscillator = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function() {
    const osc = origCreateOscillator.call(this);
    const origConnect = osc.connect.bind(osc);
    osc.connect = function(dest) {
      if (dest.constructor.name === 'AnalyserNode') {
        // Add tiny noise to prevent fingerprint matching
      }
      return origConnect(dest);
    };
    return osc;
  };
}

// 9. Fix hardware/device fingerprints
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

// 10. Fix connection API
if (!navigator.connection) {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      effectiveType: '4g',
      rtt: 50,
      downlink: 10,
      saveData: false,
    })
  });
}
`;

/**
 * Random delay between min and max milliseconds.
 * Uses a slight bias toward the lower end to feel natural.
 */
export function humanDelay(minMs: number, maxMs: number): Promise<void> {
  // Use a skewed distribution — more short delays, occasional long ones
  const random = Math.random() * Math.random(); // biased toward 0
  const delay = minMs + random * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, Math.round(delay)));
}

/**
 * Connect to an existing Chrome via CDP or launch a stealth headless browser.
 */
export async function connectBrowser(options: ConnectOptions = {}): Promise<BrowserConnection> {
  if (options.cdpUrl) {
    const browser = await chromium.connectOverCDP(options.cdpUrl);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error(
        `No browser contexts found at ${options.cdpUrl}. Is Chrome running with --remote-debugging-port?`
      );
    }
    const pages = contexts[0].pages();
    if (pages.length === 0) {
      throw new Error(
        `No pages found in browser at ${options.cdpUrl}. Open a tab first.`
      );
    }
    return { browser, page: pages[0], isManaged: false };
  }

  // Launch with stealth configuration
  const headless = options.headless ?? true;
  const launchOptions: any = {
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      // Required when running as root in containers (e.g. kubemind agent pods)
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ],
  };

  if (options.proxy) {
    launchOptions.proxy = { server: options.proxy };
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-CH-UA": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"macOS"',
      "DNT": "1",
    },
    ...(options.sessionPath ? { storageState: options.sessionPath } : {}),
  });

  // Inject cookies before any page loads
  if (options.cookies?.length) {
    await context.addCookies(options.cookies);
  }

  // Inject stealth scripts before any page loads
  await context.addInitScript(STEALTH_SCRIPTS);

  const page = await context.newPage();
  return { browser, page, isManaged: true };
}

/**
 * Navigate to a URL with human-like behavior.
 *
 * 1. Navigate with domcontentloaded
 * 2. Wait for networkidle or timeout
 * 3. Scroll down the page (triggers lazy content + looks human)
 * 4. Short human-like pause
 */
export async function navigateTo(
  page: Page,
  url: string,
  options: {
    timeout?: number;
    waitForSelector?: string;
    referrer?: string;
    settleMs?: number;
  } = {}
): Promise<void> {
  const timeout = options.timeout ?? 30_000;

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout,
    ...(options.referrer ? { referer: options.referrer } : {}),
  });

  // If a specific selector was requested, wait for it
  if (options.waitForSelector) {
    await page.waitForSelector(options.waitForSelector, { timeout });
    return;
  }

  // Smart wait: try networkidle with a shorter timeout
  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 10_000) });
  } catch {
    // networkidle timed out — that's OK for SPAs
  }

  // Wait for the app to actually render something. Client-hydrated frameworks
  // (enterprise component frameworks most acutely) serve the whole payload and reach
  // readyState "complete" while document.body is still empty — networkidle can
  // pass and the fixed delay below can expire before the first paint. Capturing
  // then yields a one-node snapshot with a generic site-level title, which is
  // what the shell_markers sweep exists to mop up. Waiting on the condition
  // instead of the clock removes most of those at the source.
  //
  // Deliberately non-fatal: a legitimately text-free page (an image or a PDF
  // viewer) should still be captured, so a timeout here falls through.
  try {
    // Passed as a string (like scrollPage below) because tsconfig omits the DOM lib.
    await page.waitForFunction(
      `!!(document.body && document.body.innerText.trim().length > 0)`,
      undefined,
      { timeout: Math.min(timeout, 15_000) }
    );
  } catch {
    // Never rendered text — capture whatever is there.
  }

  await settleOnly(page, { settleMs: options.settleMs });
}

/**
 * The post-load settle, without navigating: wait for the app to paint, then
 * scroll to trigger lazy content. Used directly when preActions already left
 * the browser on the page we want, where re-navigating would reset it.
 */
export async function settleOnly(
  page: Page,
  options: { settleMs?: number } = {}
): Promise<void> {
  // Give SPAs time to render. Configurable per site (settleMs): the built-in
  // wait only requires that the body have SOME text, which an app shell's nav
  // bar satisfies immediately, so a console whose content pane is still loading
  // gets captured empty. Default unchanged at 2s so no existing crawl slows.
  await page.waitForTimeout(options.settleMs ?? 2000);

  // Scroll down the page — triggers lazy-loaded content and simulates human reading
  await scrollPage(page);
}

/**
 * Scroll through the page in a human-like pattern.
 * Triggers lazy-loaded content and appears natural to bot detectors.
 */
async function scrollPage(page: Page): Promise<void> {
  try {
    // Scroll runs in browser context via evaluate — uses DOM APIs
    await page.evaluate(`(async () => {
      const totalHeight = document.body.scrollHeight;
      const viewportHeight = window.innerHeight;
      let scrolled = 0;
      while (scrolled < totalHeight) {
        const distance = 200 + Math.random() * 400;
        window.scrollBy(0, distance);
        scrolled += distance;
        await new Promise(r => setTimeout(r, 50 + Math.random() * 150));
        if (scrolled > totalHeight + viewportHeight) break;
      }
      window.scrollTo(0, 0);
    })()`);
  } catch {
    // Scroll failed — page might have restricted it, that's fine
  }
}

/**
 * Try to dismiss cookie consent banners.
 * Called after page load to clear overlays that might interfere.
 */
export async function dismissCookieBanners(page: Page): Promise<void> {
  const selectors = [
    '[id*="cookie"] button[id*="accept"]',
    '[id*="cookie"] button[id*="agree"]',
    '[class*="cookie"] button[class*="accept"]',
    '[id*="consent"] button[id*="accept"]',
    'button[id*="onetrust-accept"]',
    '#accept-cookies',
    '.cookie-banner button.accept',
    '[aria-label*="Accept cookies"]',
    '[aria-label*="Accept all"]',
  ];

  for (const selector of selectors) {
    try {
      const button = await page.$(selector);
      if (button && await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      // Selector didn't match — try next
    }
  }
}

export async function closeBrowser(conn: BrowserConnection): Promise<void> {
  if (conn.isManaged) {
    await conn.browser.close();
  }
}
