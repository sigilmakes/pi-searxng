# pi-searxng Architecture

`pi-searxng` is a CLI-first pi package for local web search. The pi extension owns lifecycle and status; agents search and fetch through the `searx` CLI.

## Components

```mermaid
flowchart LR
    Agent[Agent / shell] --> CLI[searx CLI]
    Pi[pi extension<br/>/searxng] --> Lifecycle[Lifecycle setup<br/>PATH, symlink, services]
    Lifecycle --> CLI
    Lifecycle --> Docker[Docker Compose<br/>SearXNG]
    Lifecycle --> Render[Render server<br/>localhost:8118]

    CLI --> Client[src/lib/searxng.ts<br/>SearXNG API client]
    Client --> SearXNG[SearXNG<br/>localhost:8042]
    SearXNG --> Engines[Enabled engines]
    Engines -->|browser-backed| Custom[Custom Python engines<br/>google_pw / ddg_pw / brave_pw]
    Custom --> Render
    Render --> Browser[Bundled Chromium via playwright-chromium]

    CLI --> Fetch[src/lib/fetch.ts]
    Fetch --> Markitdown[markitdown via uvx]
    Fetch --> BrowserLib[src/lib/browser.ts]
    BrowserLib --> Browser
```

- `bin/searx` — executable wrapper loaded by pi and shell PATH.
- `src/cli.ts` — Commander CLI entrypoint.
- `src/index.ts` — thin pi extension: `/searxng`, PATH/symlink setup, session-start lifecycle.
- `src/lib/searxng.ts` — SearXNG JSON API client and engine listing.
- `src/lib/service.ts` — Docker Compose lifecycle for the bundled SearXNG service.
- `src/lib/browser.ts` — Playwright rendering/auth using bundled `playwright-chromium`, with optional system browser override.
- `src/lib/render.ts` — background render-server lifecycle and PID/log files.
- `src/render-server.ts` — HTTP service used by custom SearXNG engines.
- `docker/` — Docker Compose, SearXNG settings, and custom offline engines.
- `skills/search/` — agent-facing operational guidance.

## Data flow: search

```mermaid
sequenceDiagram
    participant A as Agent shell
    participant C as searx CLI
    participant S as SearXNG :8042
    participant E as Playwright engine<br/>in Docker
    participant R as Render server :8118
    participant B as Chromium

    A->>C: searx search "query" --text
    C->>S: GET /search?format=json
    S->>E: search(query)
    E->>R: POST /render { url }
    R->>B: render search page
    B-->>R: html + text
    R-->>E: rendered document
    E-->>S: parsed results
    S-->>C: JSON results
    C-->>A: normalized JSON or text
```

1. Agent runs `searx search ...` from bash.
2. CLI calls local SearXNG at `http://localhost:8042/search?format=json`.
3. SearXNG queries enabled engines.
4. Browser-backed engines call `http://host.docker.internal:8118/render`.
5. Render server launches/reuses Chromium through Playwright and returns HTML/text.
6. Custom Python engine parses results and returns them to SearXNG.
7. CLI normalizes output to JSON or `--text`.

## Data flow: fetch/browse

- `searx fetch URL` uses markitdown first and browser rendering when forced or needed.
- `searx browse URL` directly renders through Playwright and extracts text/selectors.

## Design rules

- CLI is the primary interface; keep pi tools thin.
- Extension commands manage lifecycle/status, not search results.
- Use generic browser configuration (`SEARX_BROWSER_PATH`, persistent config), not platform monkey patches.
- Use human-auth browser profiles; no CAPTCHA solver or stealth-bypass dependency.
