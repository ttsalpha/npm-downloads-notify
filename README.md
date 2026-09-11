# npm-downloads-notify

Cloudflare Worker that posts weekly and monthly npm download stats to Discord.

## Config

Everything is read from env at runtime — nothing is committed in `wrangler.toml`.

Required:

| Var                   | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `PACKAGE_NAMES`       | Comma-separated npm packages, e.g. `@ttsalpha/qrcode,left-pad` |
| `DISCORD_WEBHOOK_URL` | Discord channel webhook                                        |

Optional:

| Var               | Default | Description                                                             |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| `TIMEZONE`        | `UTC`   | IANA timezone the schedule and the date in the message are expressed in |
| `NOTIFY_HOUR`     | `10`    | Local hour (0-23) to post at                                            |
| `NOTIFY_INTERVAL` | `daily` | `daily` or `weekly`                                                     |
| `NOTIFY_WEEKDAY`  | `mon`   | Day to post on when `NOTIFY_INTERVAL=weekly`; `mon` or `monday`         |

An invalid value throws rather than falling back to the default, and the whole config is validated
before any network call.

The cron in `wrangler.toml` runs hourly and the worker posts only when the local time matches, so
changing the schedule is an env change, not a redeploy.

## Setup

```sh
pnpm install
cp .dev.vars.example .dev.vars   # fill in the values
pnpm secrets                     # uploads .dev.vars to Cloudflare
```

`pnpm secrets` wraps `wrangler secret bulk .dev.vars`. To change one value later:

```sh
pnpm secret NOTIFY_HOUR
```

Secrets survive `wrangler deploy`, so config and code are updated independently.

## Deploy

```sh
pnpm wrangler deploy
```

## Manual test

`.dev.vars` is picked up by `wrangler dev`:

```sh
pnpm wrangler dev
```

Or against the deployed worker — the `/` route notifies immediately, ignoring the schedule:

```sh
curl https://npm-downloads-notify.<your-subdomain>.workers.dev
```

A response starting with `ok` means the message was pushed to Discord.
