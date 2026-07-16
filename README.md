# Tick

A minimal, ephemeral checklist. Single-file Cloudflare Worker, backed by Workers KV, zero dependencies, no build step.

Tick is for short-lived lists — today's errands, prework for a course, a packing list — not long-term task management. Lists sync across devices, and anything untouched for 30 days quietly expires.

## How it works

Every list lives at its own URL. The path *is* the navigation:

- `/` — index of your lists, sorted by your manual order (newest first until you reorder)
- `/course-prework` — a list; visiting a path that doesn't exist yet starts a blank one

On a list page you can add items (Enter), edit inline (click the text), reorder (drag the ≡ handle), check items off (they gray out but stay in place), and rename the list (click the title). The index shows each list with its `done / total` count, and supports the same drag-to-reorder and delete.

State is stored in KV — one key per list, plus one key for manual ordering. The client debounces writes, flushes pending changes on page close via `sendBeacon`, and silently refreshes when the tab regains focus, so a list checked off on your phone is current when you open it on your laptop.

## Deploy

Requires a Cloudflare account and Node.js (for `npx`).

```bash
# 1. Create the KV namespace
npx wrangler kv namespace create TICK_KV

# 2. Paste the generated namespace id into wrangler.toml

# 3. Deploy
npx wrangler deploy
```

The worker will be live at `tick.<your-subdomain>.workers.dev`, or attach a custom domain from the Cloudflare dashboard.

## Configuration

- `TTL_DAYS` (top of `worker.js`, default `30`) — lists expire after this many days without a write; any change to a list resets its clock. Remove the `expirationTtl` option from the KV `put` if you want lists to live forever.

## API

The worker exposes a minimal JSON API, used by its own frontend:

| Route | Method | Purpose |
|---|---|---|
| `/api/lists` | GET | Index of lists (from KV metadata) |
| `/api/list/:slug` | GET | List state |
| `/api/list/:slug` | PUT | Save list state |
| `/api/list/:slug` | DELETE | Delete a list |
| `/api/order` | PUT | Save manual list ordering |

## Notes

- **No authentication.** Anyone with the URL can read and edit your lists. For a personal deployment, put the worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) — one policy, no code changes.
- **Eventual consistency.** KV's `list()` operation can lag writes by a few seconds, so a newly created list may take a moment to appear on the index. List contents themselves are unaffected.
- Free-plan KV limits (100k reads, 1k writes per day) are far beyond what personal use of this will ever touch.
