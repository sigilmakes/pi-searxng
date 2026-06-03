# Search Skill: Render Server

Playwright-backed SearXNG engines call a host render server. The render server uses `playwright-core` directly and reuses configured browser state/profile.

## Lifecycle

```bash
searx render status
searx render start
searx render restart
searx render stop
```

The pi extension starts the render server on session start when `autoStartRenderServer` is true.

## Engines

- `duckduckgo playwright` — default browser-rendered general search.
- `google playwright` — enabled, best after browser auth.
- `brave playwright` — available but sparse; keep as explicit opt-in.

## After config/auth changes

Always restart render after changing browser auth/profile/config:

```bash
searx render restart
searx doctor --text
```

SearXNG itself may need restart after engine/settings changes:

```bash
searx restart
```
