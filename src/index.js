// SPDX-License-Identifier: AGPL-3.0-or-later
const JSON_CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
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
const UPSTREAM_HEADERS = { "User-Agent": "scrobblage (+https://github.com/headdirt/scrobblage)" };

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_CORS_HEADERS, ...init.headers },
  });
}

const SOURCES = {
  lastfm: {
    name: "Last.fm",
    fetch: fetchLastfmTopAlbums,
    read: readLastfmAlbums,
  },
  listenbrainz: {
    name: "ListenBrainz",
    fetch: fetchListenBrainzReleaseGroups,
    read: readListenBrainzAlbums,
  },
};

// ListenBrainz uses calendar ranges ("week" is the previous full week).
const LISTENBRAINZ_RANGES = {
  "7day": "week",
  "1month": "month",
  "3month": "quarter",
  "6month": "half_yearly",
  "12month": "year",
  overall: "all_time",
};

export function validateCollageParams(searchParams) {
  const source = searchParams.get("source") || "lastfm";
  const user = (searchParams.get("user") || "").trim();
  const period = searchParams.get("period") || "7day";
  const size = searchParams.get("size") || "5";
  const nocover = searchParams.get("nocover");
  const skipNocover = nocover === "true" || nocover === "1";
  const page = searchParams.get("page") || "1";

  if (!Object.hasOwn(SOURCES, source)) return { error: "Invalid source." };
  const sourceName = SOURCES[source].name;
  if (!user) return { error: `${sourceName} username is required.` };
  if (user.length > MAX_USER_LENGTH) return { error: `${sourceName} username is too long.` };
  if (!ALLOWED_PERIODS.has(period)) return { error: "Invalid time period." };
  if (!ALLOWED_SIZES.has(size)) return { error: "Invalid grid size." };
  if (!/^[1-9]\d*$/.test(page) || Number(page) > MAX_PAGES || (!skipNocover && page !== "1")) {
    return { error: "Invalid album page." };
  }

  const slots = Number(size) ** 2;
  return { source, user, period, skipNocover, slots, page: Number(page) };
}

export function parseLastfmAlbums(data) {
  const albums = data?.topalbums?.album;
  if (!Array.isArray(albums)) return [];
  return albums.filter(isObject).map((album) => {
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
      playcount: normalizePlaycount(album.playcount),
    };
  });
}

export function parseListenBrainzAlbums(data) {
  const groups = data?.payload?.release_groups;
  if (!Array.isArray(groups)) return [];
  return groups.filter(isObject).map((group) => {
    const mbid = typeof group.caa_release_mbid === "string" ? group.caa_release_mbid : "";
    const caaId = /^[1-9]\d*$/.test(String(group.caa_id)) ? String(group.caa_id) : "";
    return {
      artist: (typeof group.artist_name === "string" && group.artist_name) || "Unknown",
      album: (typeof group.release_group_name === "string" && group.release_group_name) || "Unknown",
      image_url: /^[0-9a-f-]{36}$/i.test(mbid) && caaId
        ? `https://coverartarchive.org/release/${mbid}/${caaId}-500.jpg`
        : "",
      playcount: normalizePlaycount(group.listen_count),
    };
  });
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizePlaycount(value) {
  return /^(0|[1-9]\d*)$/.test(String(value)) ? String(value) : "0";
}

async function fetchLastfmTopAlbums(env, { user, period, slots, page }, signal) {
  const params = new URLSearchParams({
    method: "user.getTopAlbums",
    user,
    period,
    limit: slots,
    page,
    api_key: env.LASTFM_API_KEY,
    format: "json",
  });

  return fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, { headers: UPSTREAM_HEADERS, signal });
}

async function fetchListenBrainzReleaseGroups(env, { user, period, slots, page }, signal) {
  const params = new URLSearchParams({
    range: LISTENBRAINZ_RANGES[period],
    count: slots,
    offset: (page - 1) * slots,
  });

  return fetch(
    `https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(user)}/release-groups?${params}`,
    { headers: UPSTREAM_HEADERS, signal }
  );
}

function readLastfmAlbums(data, params) {
  if (data.error) return { error: data.message || "Last.fm API error" };
  if (!Array.isArray(data.topalbums?.album)) return { error: "Last.fm returned invalid album data." };

  const totalPages = Number(data.topalbums["@attr"]?.totalPages);
  return {
    albums: parseLastfmAlbums(data),
    hasMore: Number.isInteger(totalPages) && totalPages >= 0
      ? params.page < totalPages
      : data.topalbums.album.length >= params.slots,
  };
}

function readListenBrainzAlbums(data, params) {
  const groups = data.payload?.release_groups;
  if (!Array.isArray(groups)) return { error: "ListenBrainz returned invalid album data." };

  const total = Number(data.payload.total_release_group_count);
  return {
    albums: parseListenBrainzAlbums(data),
    hasMore: Number.isInteger(total) && total >= 0
      ? params.page * params.slots < total
      : groups.length >= params.slots,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/collage-data") {
      const params = validateCollageParams(url.searchParams);
      if (params.error) {
        return jsonResponse({ message: params.error }, { status: 400 });
      }
      const source = SOURCES[params.source];
      if (params.source === "lastfm" && !env.LASTFM_API_KEY) {
        return jsonResponse(
          { message: "Last.fm API key is not configured." },
          { status: 500 }
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const resp = await source.fetch(env, params, controller.signal);
        // ListenBrainz answers 204 when a user's stats have not been calculated yet.
        if (resp.status === 204) {
          return jsonResponse({ albums: [], nextPage: null, searchLimitReached: false });
        }
        const data = await resp.json().catch((err) => {
          if (controller.signal.aborted) throw err;
          return null;
        });

        if (!resp.ok) {
          return jsonResponse(
            { message: data?.message || data?.error || `${source.name} request failed (${resp.status})` },
            { status: resp.status }
          );
        }

        if (!data) {
          return jsonResponse(
            { message: `${source.name} returned an invalid response.` },
            { status: 502 }
          );
        }

        const parsed = source.read(data, params);
        if (parsed.error) {
          return jsonResponse({ message: parsed.error }, { status: 502 });
        }

        let { albums } = parsed;
        if (params.skipNocover) {
          albums = albums.filter((album) => album.image_url);
        }

        const nextPage = params.skipNocover && parsed.hasMore && params.page < MAX_PAGES
          ? params.page + 1 : null;
        return jsonResponse({
          albums: albums.slice(0, params.slots),
          nextPage,
          searchLimitReached: params.skipNocover && parsed.hasMore && params.page === MAX_PAGES,
        });
      } catch {
        return jsonResponse(
          { message: controller.signal.aborted ? `${source.name} took too long to respond. Please try again.` : `Failed to reach ${source.name}. Please try again.` },
          { status: controller.signal.aborted ? 504 : 502 }
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
