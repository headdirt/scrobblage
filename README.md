# scrobblage

Generate a collage of your top albums from [Last.fm](https://www.last.fm/).

## Features

- Grid sizes from 3x3 to 10x10
- Time periods from last 7 days to all-time
- Show or hide play counts and artist/album captions
- Skip albums without cover art
- Download or copy the result to clipboard
- Shareable permalink URLs

## How it works

A [Cloudflare Worker](https://developers.cloudflare.com/workers/) proxies requests to the Last.fm API. The frontend fetches album art and composites it onto an HTML canvas.

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

[AGPL-3.0](LICENSE)
