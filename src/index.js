// SPDX-License-Identifier: AGPL-3.0-or-later
const JSON_CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const ALLOWED_METHODS = new Set(["user.getTopAlbums"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lastfm") {
      const params = new URLSearchParams(url.search);
      const method = params.get("method");
      if (!method || !ALLOWED_METHODS.has(method)) {
        return new Response(
          JSON.stringify({ error: 1, message: "Method not allowed" }),
          { status: 403, headers: JSON_CORS_HEADERS }
        );
      }
      try {
        params.set("api_key", env.LASTFM_API_KEY);
        params.set("format", "json");
        const resp = await fetch(
          `https://ws.audioscrobbler.com/2.0/?${params}`
        );
        return new Response(resp.body, {
          status: resp.status,
          headers: JSON_CORS_HEADERS,
        });
      } catch {
        return new Response(
          JSON.stringify({ error: 1, message: "Failed to reach Last.fm" }),
          { status: 502, headers: JSON_CORS_HEADERS }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
