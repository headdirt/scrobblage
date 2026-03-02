export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lastfm") {
      try {
        const params = new URLSearchParams(url.search);
        params.set("api_key", env.LASTFM_API_KEY);
        params.set("format", "json");
        const resp = await fetch(
          `https://ws.audioscrobbler.com/2.0/?${params}`
        );
        return new Response(resp.body, {
          status: resp.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch {
        return new Response(
          JSON.stringify({ error: 1, message: "Failed to reach Last.fm" }),
          {
            status: 502,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
