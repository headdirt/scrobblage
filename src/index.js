// SPDX-License-Identifier: AGPL-3.0-or-later
const JSON_CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const ALLOWED_PERIODS = new Set([
  "7day",
  "1month",
  "3month",
  "6month",
  "12month",
  "overall",
]);
const ALLOWED_SIZES = new Set(["3", "4", "5", "7", "10"]);
const MAX_USER_LENGTH = 64;
const MAX_PAGES = 5;
const REQUEST_TIMEOUT_MS = 15000;

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_CORS_HEADERS, ...init.headers },
  });
}

export function validateCollageParams(searchParams) {
  const user = (searchParams.get("user") || "").trim();
  const period = searchParams.get("period") || "7day";
  const size = searchParams.get("size") || "5";
  const nocover = searchParams.get("nocover");
  const skipNocover = nocover === "true" || nocover === "1";
  const page = searchParams.get("page") || "1";

  if (!user) return { error: "Last.fm username is required." };
  if (user.length > MAX_USER_LENGTH) return { error: "Last.fm username is too long." };
  if (!ALLOWED_PERIODS.has(period)) return { error: "Invalid time period." };
  if (!ALLOWED_SIZES.has(size)) return { error: "Invalid grid size." };
  if (!/^[1-9]\d*$/.test(page) || Number(page) > MAX_PAGES || (!skipNocover && page !== "1")) {
    return { error: "Invalid album page." };
  }

  const slots = Number(size) ** 2;
  return { user, period, skipNocover, slots, page: Number(page) };
}

export function parseAlbums(data) {
  const albums = data?.topalbums?.album;
  if (!Array.isArray(albums)) return [];
  return albums.filter((album) => album && typeof album === "object" && !Array.isArray(album)).map((album) => {
    const images = (Array.isArray(album.image) ? album.image : [])
      .filter((image) => typeof image?.["#text"] === "string" && image["#text"].trim());
    const imageUrl =
      images.find((image) => image.size === "extralarge" && image["#text"])?.["#text"] ||
      images.findLast((image) => image["#text"])?.["#text"] ||
      "";

    return {
      artist: (typeof album.artist?.name === "string" && album.artist.name) || "Unknown",
      album: (typeof album.name === "string" && album.name) || "Unknown",
      image_url: imageUrl,
      playcount: /^(0|[1-9]\d*)$/.test(String(album.playcount)) ? String(album.playcount) : "0",
    };
  });
}

async function fetchTopAlbums(env, { user, period, limit, page }, signal) {
  const params = new URLSearchParams({
    method: "user.getTopAlbums",
    user,
    period,
    limit,
    page,
    api_key: env.LASTFM_API_KEY,
    format: "json",
  });

  return fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, { signal });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/collage-data") {
      const params = validateCollageParams(url.searchParams);
      if (params.error) {
        return jsonResponse({ message: params.error }, { status: 400 });
      }
      if (!env.LASTFM_API_KEY) {
        return jsonResponse(
          { message: "Last.fm API key is not configured." },
          { status: 500 }
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetchTopAlbums(env, { ...params, limit: params.slots }, controller.signal);
        const data = await resp.json().catch((err) => {
          if (controller.signal.aborted) throw err;
          return null;
        });

        if (!resp.ok) {
          return jsonResponse(
            { message: data?.message || `Last.fm request failed (${resp.status})` },
            { status: resp.status }
          );
        }

        if (!data) {
          return jsonResponse(
            { message: "Last.fm returned an invalid response." },
            { status: 502 }
          );
        }

        if (data.error) {
          return jsonResponse(
            { message: data.message || "Last.fm API error" },
            { status: 502 }
          );
        }

        if (!Array.isArray(data.topalbums?.album)) {
          return jsonResponse({ message: "Last.fm returned invalid album data." }, { status: 502 });
        }

        let albums = parseAlbums(data);
        if (params.skipNocover) {
          albums = albums.filter((album) => album.image_url);
        }

        const totalPages = Number(data.topalbums["@attr"]?.totalPages);
        const hasMore = Number.isInteger(totalPages) && totalPages >= 0
          ? params.page < totalPages
          : data.topalbums.album.length >= params.slots;
        const nextPage = params.skipNocover && hasMore && params.page < MAX_PAGES
          ? params.page + 1 : null;
        return jsonResponse({
          albums: albums.slice(0, params.slots),
          nextPage,
          searchLimitReached: params.skipNocover && hasMore && params.page === MAX_PAGES,
        });
      } catch {
        return jsonResponse(
          { message: controller.signal.aborted ? "Last.fm took too long to respond. Please try again." : "Failed to reach Last.fm. Please try again." },
          { status: controller.signal.aborted ? 504 : 502 }
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
