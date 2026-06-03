# pi-searxng

SearXNG integration for pi. Provides a composable `searx` CLI, a `/searxng` TUI command, local SearXNG Docker lifecycle management, and Playwright-powered browser rendering via `playwright-core`.

## Install

```bash
pi install git:github.com/sigilmakes/pi-searxng
```

The extension symlinks `searx` into `~/.pi/agent/bin/` on session start so it is available from bash.

## CLI

```bash
searx search "query"                     # JSON results (default)
searx search "query" --text              # Human-readable
searx search "query" -c it -n 3          # IT category, 3 results
searx search "query" -e "duckduckgo playwright"
searx search "query" --json | jq '.'     # Raw SearXNG response

searx fetch "https://example.com"        # markitdown/auto browser fallback
searx fetch "https://example.com" --browser --text
searx fetch "$URL" -n 3000 -o 3000       # paginate long documents

searx browse "https://example.com" --text
searx browse "https://example.com" --extract "h1,h2"

searx browser-auth "https://www.google.com/search?q=test"
searx render-server --port 8118

searx status --text
searx start / stop / restart
searx engines --text
```

All output is JSON by default. Add `--text` for human-readable output.

## Browser rendering

`searx browse` and `searx fetch --browser` use the Playwright Node API directly. No `playwright-cli`, no subprocess session juggling.

Browser binary selection:

```bash
# Standard systems: install Playwright chromium if desired
npx playwright install chromium

# Custom browser path (NixOS, system Chromium, etc.)
export SEARX_BROWSER_PATH=$(which chromium)
```

Human-auth storage:

```bash
searx browser-auth "https://www.google.com/search?q=test"
export SEARX_BROWSER_STATE=~/.pi/agent/searx-browser-state.json
```

`browser-auth` opens a headed browser. You solve/login manually, press Enter in the terminal, and the CLI saves storage state for later renders. The package does not use CAPTCHA-solving services or stealth bypass libraries.

## Playwright-backed SearXNG engines

The Docker config mounts custom offline engines:

- `duckduckgo playwright` — works; browser-rendered DDG general search
- `brave playwright` — partial; Brave rendering works but results can be sparse
- `google playwright` — requires human-auth state when Google presents CAPTCHA

The engines call the host render server at `http://host.docker.internal:8118/render`. Start it before using the Playwright engines:

```bash
export SEARX_BROWSER_PATH=$(which chromium)   # if needed
searx render-server --port 8118
searx restart
searx search "rust async" -e "duckduckgo playwright" --text
```

## Pi extension

`/searxng` supports: `status`, `start`, `stop`, `restart`, `engines`.

On session start it:

1. Adds the package `bin/` and `node_modules/.bin/` to PATH
2. Symlinks `searx` into `~/.pi/agent/bin/`
3. Starts SearXNG if it is not already running

## Requirements

- Docker
- Node.js
- `uvx` for markitdown fetch fallback
- Chromium/Chrome for browser rendering (`SEARX_BROWSER_PATH` can point to it)
