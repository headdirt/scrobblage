# <img src="public/favicon.svg" width="32" height="32" alt=""> scrobblage

Generate a collage of your top albums from [Last.fm](https://www.last.fm/) or [ListenBrainz](https://listenbrainz.org/).

## Features

- Last.fm or ListenBrainz as the data source
- Grid sizes from 3x3 to 10x10
- Time periods from last 7 days to all-time
- Show or hide play counts and artist/album captions
- Skip albums without cover art
- Replace broken covers, with a notice when there are not enough usable albums
- Cancel generation; slow requests and images time out automatically
- Shorten long captions with an ellipsis inside their tiles, with an optional background fitted to each line
- Download or copy the result to clipboard
- Bookmarkable permalink URLs

## URL Parameters

All settings can be controlled via query parameters, making your preferred collage bookmarkable.

| Parameter | Description | Values |
|-----------|-------------|--------|
| `source` | Listening data source | `lastfm` (default), `listenbrainz` |
| `user` | Last.fm or ListenBrainz username | |
| `period` | Time range | `7day` (default), `1month`, `3month`, `6month`, `12month`, `overall` |
| `size` | Grid size | `3`, `4`, `5` (default), `7`, `10` |
| `captions` | Show artist/album names | `false` to hide (shown by default) |
| `playcount` | Show play counts | `true` to show (hidden by default) |
| `nocover` | Skip albums without art | `true` to skip |
| `background` | Add a subtle background behind captions and play counts | `true` to enable |
| `auto` | Generate on page load | present (any value) |

Example: `?user=rj&period=7day&size=5&auto`

ListenBrainz statistics use calendar ranges, so `period` maps to the previous full week, month, quarter, half year or year (`overall` is all time). ListenBrainz recalculates statistics periodically, so very recent listens may not appear yet.

## How it works

A [Cloudflare Worker](https://developers.cloudflare.com/workers/) fetches and normalizes top album data from the Last.fm API or the ListenBrainz statistics API (which needs no key). ListenBrainz covers come from the [Cover Art Archive](https://coverartarchive.org/). Successful album responses are cached at the edge for 5 minutes (Last.fm) or an hour (ListenBrainz, whose statistics update periodically). The frontend fetches album art and composites it onto an HTML canvas.

When skipping missing covers, the frontend checks albums in ranking order and requests another page when covers fail to load. It searches at most five pages (five times the grid's tile count, up to 500 albums). If there are still not enough usable covers, the remaining tiles stay blank and a notice explains the shortfall. Image loads have an eight-second deadline, including one retry; a whole generation is limited to one minute.

## Setup

1. Install dependencies:

```
npm install
```

2. Set your Last.fm API key (get one [here](https://www.last.fm/api/account/create)):

```
echo "LASTFM_API_KEY=your_key_here" > .dev.vars
```

For production, add the secret via Wrangler:

```
npx wrangler secret put LASTFM_API_KEY
```

3. Run locally:

```
npm run dev
```

4. Deploy:

```
npm run deploy
```

## Development

Use Node.js 22 or newer. Run the Worker unit tests:

```
npm test
```

Install Chromium once and run the browser tests:

```
npx playwright install chromium
npm run test:browser
```

The browser tests start a local Worker on port 8787 and use simulated album data and cover images, so no API key is needed. They cover asset routing, generation, downloads, URL settings, broken and stalled covers, cancellation, and caption rendering. Run both suites with `npm run test:all`. To use an installed Chromium-based browser instead of downloading Playwright's, set `PW_EXECUTABLE_PATH`, for example `PW_EXECUTABLE_PATH=/Applications/Helium.app/Contents/MacOS/Helium npm run test:browser`.

Regenerate the inlined HTML version:

```
npm run build:standalone
```

The generated HTML includes the styles and scripts, but still needs to be served from the same origin as the Worker API; it is not an offline app.

The hosted app loads JavaScript from `public/app.js` and applies security headers from `public/_headers`. Its content-security policy blocks inline scripts and embedding in other sites while allowing HTTPS album covers and generated images. The standalone export inlines its script, so a host serving that export must explicitly allow that script (for example, with a matching CSP hash).

## License

[AGPL-3.0-or-later](LICENSE)
