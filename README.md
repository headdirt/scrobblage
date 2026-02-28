# scrobblage

Generate a collage of your top albums from [Last.fm](https://www.last.fm/).

## Features

- Grid sizes from 3x3 to 10x10
- Time periods from last 7 days to all-time
- Optional play count display
- Option to hide artist/album captions
- Option to skip albums without cover art

## Setup

Runs as a [Cloudflare Worker](https://developers.cloudflare.com/workers/) with static assets.

1. Clone the repo and install dependencies:

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

## How it works

The frontend sends requests to `/api/lastfm`, which proxies to the Last.fm API (appending the API key server-side). Album art is fetched and composited onto an HTML canvas, then exported as a PNG.

## License

[AGPL-3.0](LICENSE)
