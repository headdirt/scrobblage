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

  if (!user) return { error: "Last.fm username is required." };
  if (user.length > MAX_USER_LENGTH) return { error: "Last.fm username is too long." };
  if (!ALLOWED_PERIODS.has(period)) return { error: "Invalid time period." };
  if (!ALLOWED_SIZES.has(size)) return { error: "Invalid grid size." };

  const slots = Number(size) ** 2;
  return { user, period, skipNocover, slots };
}

export function parseAlbums(data) {
  return (data?.topalbums?.album || []).map((album) => {
    const images = album.image || [];
    const imageUrl =
      images.find((image) => image.size === "extralarge" && image["#text"])?.["#text"] ||
      images.findLast((image) => image["#text"])?.["#text"] ||
      "";

    return {
      artist: album.artist?.name || "Unknown",
      album: album.name || "Unknown",
      image_url: imageUrl,
      playcount: album.playcount || "0",
    };
  });
}

async function fetchTopAlbums(env, { user, period, limit }) {
  const params = new URLSearchParams({
    method: "user.getTopAlbums",
    user,
    period,
    limit,
    api_key: env.LASTFM_API_KEY,
    format: "json",
  });

  return fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
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

      const limit = params.skipNocover ? params.slots * 3 : params.slots;
      try {
        const resp = await fetchTopAlbums(env, { ...params, limit });
        const data = await resp.json().catch(() => null);

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

        let albums = parseAlbums(data);
        if (params.skipNocover) {
          albums = albums.filter((album) => album.image_url);
        }

        return jsonResponse({ albums: albums.slice(0, params.slots) });
      } catch (err) {
        return jsonResponse(
          { message: err.message || "Failed to reach Last.fm" },
          { status: 502 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
