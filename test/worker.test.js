// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";

import worker, { parseAlbums, validateCollageParams } from "../src/index.js";

function params(query) {
  return new URLSearchParams(query);
}

test("validateCollageParams applies defaults", () => {
  assert.deepEqual(validateCollageParams(params("user=rj")), {
    user: "rj",
    period: "7day",
    skipNocover: false,
    slots: 25,
    page: 1,
  });
});

test("validateCollageParams rejects invalid values", () => {
  assert.equal(validateCollageParams(params("")).error, "Last.fm username is required.");
  assert.equal(validateCollageParams(params("user=rj&period=year")).error, "Invalid time period.");
  assert.equal(validateCollageParams(params("user=rj&size=6")).error, "Invalid grid size.");
});

test("parseAlbums normalizes Last.fm album data", () => {
  const albums = parseAlbums({
    topalbums: {
      album: [
        {
          name: "Selected Ambient Works 85-92",
          artist: { name: "Aphex Twin" },
          playcount: "42",
          image: [
            { size: "small", "#text": "small.jpg" },
            { size: "extralarge", "#text": "large.jpg" },
          ],
        },
      ],
    },
  });

  assert.deepEqual(albums, [
    {
      artist: "Aphex Twin",
      album: "Selected Ambient Works 85-92",
      image_url: "large.jpg",
      playcount: "42",
    },
  ]);
});

test("parseAlbums tolerates empty or malformed responses", () => {
  assert.deepEqual(parseAlbums(null), []);
  assert.deepEqual(parseAlbums({}), []);
});

test("collage endpoint reports missing Last.fm API key clearly", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/collage-data?user=rj"),
    { ASSETS: { fetch: () => new Response("asset") } }
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.message, "Last.fm API key is not configured.");
});

test("collage endpoint handles malformed Last.fm JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("not json", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });

  try {
    const response = await worker.fetch(
      new Request("https://example.com/api/collage-data?user=rj"),
      {
        LASTFM_API_KEY: "test-key",
        ASSETS: { fetch: () => new Response("asset") },
      }
    );
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.message, "Last.fm returned an invalid response.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseAlbums skips malformed entries and normalizes malformed fields", () => {
  for (const album of [null, {}, "wrong"]) assert.deepEqual(parseAlbums({ topalbums: { album } }), []);
  assert.deepEqual(parseAlbums({ topalbums: { album: [null, [], 3, {
    name: {}, artist: null, image: [null, {}, { "#text": 123 }], playcount: {},
  }] } }), [{ artist: "Unknown", album: "Unknown", image_url: "", playcount: "0" }]);
  assert.equal(parseAlbums({ topalbums: { album: [{ image: {} }] } })[0].image_url, "");
});

test("pagination is bounded and only enabled for cover replacement", () => {
  for (const page of ["0", "6", "1.5", "-1", "2e0"]) {
    assert.equal(validateCollageParams(params(`user=rj&nocover=true&page=${page}`)).error, "Invalid album page.");
  }
  assert.equal(validateCollageParams(params("user=rj&page=2")).error, "Invalid album page.");
  assert.equal(validateCollageParams(params("user=rj&nocover=true&page=5")).page, 5);
});

const env = { LASTFM_API_KEY: "test-key", ASSETS: { fetch: () => new Response("missing", { status: 404 }) } };
const album = (name, image = "cover.jpg") => ({ name, artist: { name: "Artist" }, image: [{ size: "extralarge", "#text": image }] });

async function endpoint(t, payload, query = "user=rj&size=3", status = 200) {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload, { status }));
  const response = await worker.fetch(new Request(`https://example.com/api/collage-data?${query}`), env);
  return { response, body: await response.json() };
}

test("successful endpoint passes the requested period and page to Last.fm", async t => {
  const { body } = await endpoint(t, { topalbums: { album: [album("First"), album("Missing", "")], "@attr": { totalPages: "8" } } }, "user=rj&size=3&period=1month&nocover=true&page=2");
  assert.equal(body.albums.length, 1);
  assert.equal(body.nextPage, 3);
  const url = new URL(globalThis.fetch.mock.calls[0].arguments[0]);
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("period"), "1month");
  assert.equal(url.searchParams.get("limit"), "9");
});

test("last page stops replacement requests", async t => {
  const { body } = await endpoint(t, { topalbums: { album: [album("Last")], "@attr": { totalPages: "2" } } }, "user=rj&size=3&nocover=true&page=2");
  assert.equal(body.nextPage, null);
  assert.equal(body.searchLimitReached, false);
});

test("fifth page reports the search cap", async t => {
  const { body } = await endpoint(t, { topalbums: { album: [album("Last")], "@attr": { totalPages: "20" } } }, "user=rj&size=3&nocover=true&page=5");
  assert.equal(body.nextPage, null);
  assert.equal(body.searchLimitReached, true);
});

test("empty album list is a valid success", async t => {
  const { response, body } = await endpoint(t, { topalbums: { album: [] } });
  assert.equal(response.status, 200);
  assert.deepEqual(body.albums, []);
  assert.equal(body.nextPage, null);
});

test("invalid album structure returns a useful upstream error", async t => {
  const { response, body } = await endpoint(t, { topalbums: { album: {} } });
  assert.equal(response.status, 502);
  assert.equal(body.message, "Last.fm returned invalid album data.");
});

test("Last.fm application errors are surfaced", async t => {
  const { response, body } = await endpoint(t, { error: 6, message: "User not found" });
  assert.equal(response.status, 502);
  assert.equal(body.message, "User not found");
});

test("Last.fm HTTP errors retain their status", async t => {
  const { response } = await endpoint(t, { message: "Busy" }, "user=rj", 503);
  assert.equal(response.status, 503);
});

test("Last.fm timeout aborts the upstream request", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  }));
  const pending = worker.fetch(new Request("https://example.com/api/collage-data?user=rj"), env);
  t.mock.timers.tick(15000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.match((await response.json()).message, /too long/);
});

test("unmatched routes delegate to the assets binding", async () => {
  const response = await worker.fetch(new Request("https://example.com/missing"), env);
  assert.equal(response.status, 404);
});
