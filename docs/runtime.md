# Runtime and State

## Local services

- SearXNG: `http://localhost:8042`
- Render server: `http://localhost:8118`
- Docker Compose: `docker/docker-compose.yaml`

The pi extension starts SearXNG on `session_start` if it is not responding. It starts the render server when `autoStartRenderServer` is true.

## Persistent config

Config lives at:

```text
~/.pi/agent/searxng/config.json
```

Important fields:

- `browserPath` — explicit Chromium/Chrome binary path.
- `browserState` — Playwright storage state JSON path.
- `browserProfile` — persistent browser profile directory.
- `renderPort` — render server port, default `8118`.
- `autoStartRenderServer` — whether extension starts render server automatically.

Use CLI commands instead of hand-editing when possible:

```bash
searx config show
searx config set browserPath "$(which chromium)"
searx config set autoStartRenderServer true
```

## Browser auth state

Default paths:

```text
~/.pi/agent/searx-browser-state.json
~/.pi/agent/searx-browser-profile
```

Create/refresh them with:

```bash
searx browser-auth "https://www.google.com/search?q=test"
searx render restart
```

## Logs/PIDs

```text
~/.pi/agent/searx-render.pid
~/.pi/agent/logs/searx-render.log
```

Check health with `searx doctor --text` before changing runtime state.
