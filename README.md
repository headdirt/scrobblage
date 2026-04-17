# <img src="public/favicon.svg" width="32" height="32" alt=""> scrobblage

Generate a collage of your top albums from [Last.fm](https://www.last.fm/).

## Features

- Grid sizes from 3x3 to 10x10
- Time periods from last 7 days to all-time
- Show or hide play counts and artist/album captions
- Skip albums without cover art
- Download or copy the result to clipboard
- Bookmarkable permalink URLs

## URL Parameters

All settings can be controlled via query parameters, making your preferred collage bookmarkable.

| Parameter | Description | Values |
|-----------|-------------|--------|
| `user` | Last.fm username | |
| `period` | Time range | `7day` (default), `1month`, `3month`, `6month`, `12month`, `overall` |
| `size` | Grid size | `3`, `4`, `5` (default), `7`, `10` |
| `captions` | Show artist/album names | `false` to hide (shown by default) |
| `playcount` | Show play counts | `true` to show (hidden by default) |
| `nocover` | Skip albums without art | `true` to skip |
| `auto` | Generate on page load | present (any value) |

Example: `?user=rj&period=7day&size=5&auto`

## How it works

A [Cloudflare Worker](https://developers.cloudflare.com/workers/) fetches and normalizes top album data from the Last.fm API. The frontend fetches album art and composites it onto an HTML canvas.

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

## License

[AGPL-3.0-or-later](LICENSE)
