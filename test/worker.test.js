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
