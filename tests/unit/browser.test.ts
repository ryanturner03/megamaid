// tests/unit/browser.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP: vi.fn(),
    launch: vi.fn(),
  },
}));

import { chromium } from "playwright";
import { connectBrowser, navigateTo } from "../../src/core/browser.js";

describe("connectBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects via CDP when cdpUrl is provided", async () => {
    const mockPage = { url: () => "about:blank", goto: vi.fn() };
    const mockContext = { pages: () => [mockPage] };
    const mockBrowser = { contexts: () => [mockContext] };
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(mockBrowser as any);

    const result = await connectBrowser({ cdpUrl: "http://localhost:9222" });

    expect(chromium.connectOverCDP).toHaveBeenCalledWith("http://localhost:9222");
    expect(result.browser).toBe(mockBrowser);
    expect(result.page).toBe(mockPage);
  });

  it("launches headless browser with stealth config when no cdpUrl", async () => {
    const mockPage = { url: () => "about:blank", goto: vi.fn() };
    const mockContext = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      addInitScript: vi.fn().mockResolvedValue(undefined),
    };
    const mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      contexts: () => [],
    };
    vi.mocked(chromium.launch).mockResolvedValue(mockBrowser as any);

    const result = await connectBrowser({});

    expect(chromium.launch).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true })
    );
    // Stealth: should set up context with user agent and add init scripts
    expect(mockBrowser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: expect.any(String), viewport: { width: 1920, height: 1080 } })
    );
    expect(mockContext.addInitScript).toHaveBeenCalled();
    expect(result.browser).toBe(mockBrowser);
    expect(result.page).toBe(mockPage);
  });
});

describe("navigateTo", () => {
  it("navigates to URL with smart SPA wait strategy", async () => {
    const mockPage = {
      goto: vi.fn().mockResolvedValue(null),
      waitForLoadState: vi.fn().mockResolvedValue(null),
      waitForTimeout: vi.fn().mockResolvedValue(null),
    };

    await navigateTo(mockPage as any, "https://example.com");

    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    // Should also wait for networkidle + SPA render time
    expect(mockPage.waitForLoadState).toHaveBeenCalled();
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2000);
  });
});
