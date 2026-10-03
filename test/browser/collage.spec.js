// SPDX-License-Identifier: AGPL-3.0-or-later
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#2080c0"/></svg>';
const albums = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({
  artist: `Artist ${offset + i}`, album: `Album ${offset + i}`, playcount: "42", image_url: `/covers/${offset + i}.svg`,
}));
async function mockCovers(page) {
  await page.route("**/covers/**", route => route.fulfill({ contentType: "image/svg+xml", body: cover }));
}
async function mockAlbums(page, items = albums(9), extra = {}) {
  await page.route("**/api/collage-data?**", route => route.fulfill({ json: { albums: items, nextPage: null, ...extra } }));
}
const autoURL = "/?user=rj&size=3&auto";

test("real Worker serves assets and returns 404 for unknown paths", async ({ request }) => {
  expect((await request.get("/")).status()).toBe(200);
  expect((await request.get("/style.css")).headers()["content-type"]).toContain("text/css");
  expect((await request.get("/no-such-asset.txt")).status()).toBe(404);
});

test("generates from URL settings and downloads a valid JPEG", async ({ page }) => {
  await mockCovers(page);
  await mockAlbums(page);
  await page.goto(autoURL + "&period=1month&captions=false&playcount=true&background=true");
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#period")).toHaveValue("1month");
  await expect(page.locator("#hide-captions")).toBeChecked();
  await expect(page.locator("#show-playcount")).toBeChecked();
  await expect(page.locator("#caption-background")).toBeChecked();
  expect(await page.locator("canvas").evaluate(c => [c.width, c.height])).toEqual([900, 900]);
  const downloadPromise = page.waitForEvent("download");
  await page.getByText("Download Image", { exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("rj_1month_3x3.jpg");
  const bytes = await readFile(await download.path());
  expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  expect(bytes.length).toBeGreaterThan(1000);
  await page.reload();
  await expect(page.locator("#hide-captions")).toBeChecked();
  await expect(page.locator("#caption-background")).toBeChecked();
});

test("replaces broken covers using later pages in ranking order", async ({ page }) => {
  await mockCovers(page);
  await page.route("**/covers/0.svg", route => route.abort());
  const pages = [];
  await page.route("**/api/collage-data?**", route => {
    const p = Number(new URL(route.request().url()).searchParams.get("page"));
    pages.push(p);
    return route.fulfill({ json: { albums: albums(9, (p - 1) * 9), nextPage: p === 1 ? 2 : null } });
  });
  await page.goto(autoURL + "&nocover=true");
  await expect(page.locator("#result")).toBeVisible();
  expect(pages).toEqual([1, 2]);
  await expect(page.locator("#result-notice")).toHaveText("");
  // Capture the actual drawn captions on another generation.
  await page.evaluate(() => {
    window.drawn = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.drawn.push(text); return original.call(this, text, ...args);
    };
  });
  await page.locator("#submit-btn").click();
  await expect(page.locator("#result")).toBeVisible();
  expect(await page.evaluate(() => window.drawn.filter(t => t.startsWith("Album")))).toEqual(Array.from({ length: 9 }, (_, i) => `Album ${i + 1}`));
});

test("reports insufficient covers and stops at the page cap", async ({ page }) => {
  await mockCovers(page);
  const pages = [];
  await page.route("**/api/collage-data?**", route => {
    const p = Number(new URL(route.request().url()).searchParams.get("page"));
    pages.push(p);
    return route.fulfill({ json: { albums: p === 1 ? albums(1) : [], nextPage: p < 5 ? p + 1 : null, searchLimitReached: p === 5 } });
  });
  await page.goto(autoURL + "&nocover=true");
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#result-notice")).toContainText("Filled 1 of 9 tiles");
  await expect(page.locator("#result-notice")).toContainText("search limit");
  expect(pages).toEqual([1, 2, 3, 4, 5]);
});

test("stalled cover times out and generation recovers", async ({ page }) => {
  await page.clock.install();
  await mockAlbums(page, albums(1));
  await page.route("**/covers/**", () => {});
  const imageRequest = page.waitForRequest("**/covers/**");
  await page.goto(autoURL);
  await imageRequest;
  await page.clock.runFor(8100);
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#result-notice")).toContainText("1 cover could not be loaded");
  await expect(page.locator("#submit-btn")).toBeEnabled();
});

test("stalled album request times out", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/**", () => {});
  const request = page.waitForRequest("**/api/**");
  await page.goto(autoURL);
  await request;
  await page.clock.runFor(20100);
  await expect(page.locator("#error")).toContainText("too long");
  await expect(page.locator("#submit-btn")).toBeEnabled();
});

for (const phase of ["album data", "covers"]) {
  test(`cancel during ${phase} permits a fresh generation`, async ({ page }) => {
    if (phase === "covers") await mockAlbums(page);
    await page.route(phase === "covers" ? "**/covers/**" : "**/api/**", () => {});
    const pending = page.waitForRequest(phase === "covers" ? "**/covers/**" : "**/api/**");
    await page.goto(autoURL);
    await pending;
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator("#error")).toHaveText("Generation cancelled.");
    await expect(page.locator("#submit-btn")).toBeEnabled();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockAlbums(page);
    await mockCovers(page);
    await page.locator("#submit-btn").click();
    await expect(page.locator("#result")).toBeVisible();
    await expect(page.locator("#error")).toBeHidden();
  });
}

test("long captions are shortened and cannot paint into neighboring tiles", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    const canvas = document.getElementById("collage-canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 900; canvas.height = 300;
    ctx.fillStyle = "red"; ctx.fillRect(0, 0, 900, 300);
    ctx.font = "bold 14px sans-serif";
    ctx.lineWidth = 3;
    const label = "Very long album title 🎵 ".repeat(30);
    drawTile({ artist: label, album: label, playcount: "42" }, null, 0, 0, { captionBackground: true });
    const neighbor = ctx.getImageData(300, 0, 300, 60).data;
    return {
      shortened: fitText(label, 288), width: ctx.measureText(fitText(label, 288)).width,
      untouched: Array.from(neighbor).every((v, i) => v === (i % 4 === 0 || i % 4 === 3 ? 255 : 0)),
      shaded: ctx.getImageData(3, 21, 1, 1).data[0] < 255,
    };
  });
  expect(result.shortened).toMatch(/…$/);
  expect(result.width).toBeLessThanOrEqual(288);
  expect(result.untouched).toBe(true);
  expect(result.shaded).toBe(true);
});

test("empty results show a useful error", async ({ page }) => {
  await mockAlbums(page, []);
  await page.goto(autoURL);
  await expect(page.locator("#error")).toContainText("No albums found");
  await expect(page.locator("#submit-btn")).toBeEnabled();
});

test("caption backgrounds fit each line and leave unused cover art clear", async ({ page }) => {
  await page.goto("/");
  const pixels = await page.evaluate(() => {
    const canvas = document.getElementById("collage-canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.height = 300;
    ctx.fillStyle = "red"; ctx.fillRect(0, 0, 300, 300);
    ctx.font = "bold 14px sans-serif";
    drawTile({ artist: "A", album: "A much longer album name", playcount: "42" }, null, 0, 0, { captionBackground: true, showPlaycount: true });
    return [[30, 5], [30, 21], [290, 5], [290, 21], [290, 37], [3, 5]].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[0]);
  });
  expect(pixels[0]).toBe(255); // Beyond the short artist name.
  expect(pixels[1]).toBeLessThan(255); // Within the longer album's background.
  expect(pixels.slice(2, 5)).toEqual([255, 255, 255]);
  expect(pixels[5]).toBeLessThan(255);
});

test("hosted CSP permits the app but blocks inline scripts", async ({ page, request }) => {
  const response = await page.goto("/");
  expect(response.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.unexpectedScriptRan = true";
    document.body.append(script);
  });
  expect(await page.evaluate(() => window.unexpectedScriptRan)).toBeUndefined();
  const apiResponse = await request.get("/api/collage-data");
  expect(apiResponse.headers()["x-content-type-options"]).toBe("nosniff");
  await mockAlbums(page);
  await mockCovers(page);
  await page.locator("#lastfm-profile").fill("rj");
  await page.locator("#size").selectOption("3");
  await page.locator("#submit-btn").click();
  await expect(page.locator("#result")).toBeVisible();
});

test("loading progress stays concise", async ({ page }) => {
  await mockAlbums(page);
  await page.route("**/covers/**", () => {});
  await page.goto(autoURL);
  await expect(page.locator("#loading-text")).toHaveText("Loading covers (0/9)...");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("ListenBrainz source is sent to the API, relabels the form, and persists in the URL", async ({ page }) => {
  await mockCovers(page);
  let apiURL;
  await page.route("**/api/collage-data?**", route => {
    apiURL = new URL(route.request().url());
    return route.fulfill({ json: { albums: albums(9), nextPage: null } });
  });
  await page.goto(autoURL + "&source=listenbrainz&period=3month");
  await expect(page.locator("#result")).toBeVisible();
  expect(apiURL.searchParams.get("source")).toBe("listenbrainz");
  await expect(page.locator("#source")).toHaveValue("listenbrainz");
  await expect(page.locator("#profile-label")).toHaveText("ListenBrainz Profile");
  await expect(page.locator("#period option:checked")).toHaveText("Last Quarter");
  expect(new URL(page.url()).searchParams.get("source")).toBe("listenbrainz");
  expect(await page.locator("#download-link").getAttribute("download")).toBe("listenbrainz_rj_3month_3x3.jpg");
  await page.locator("#source").selectOption("lastfm");
  await expect(page.locator("#profile-label")).toHaveText("Last.fm Profile");
  await expect(page.locator("#period option:checked")).toHaveText("Last 3 Months");
});

test("empty ListenBrainz stats explain the update delay", async ({ page }) => {
  await mockAlbums(page, []);
  await page.goto(autoURL + "&source=listenbrainz");
  await expect(page.locator("#error")).toContainText("ListenBrainz statistics are updated periodically");
});
