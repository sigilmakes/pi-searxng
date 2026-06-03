# pi-searxng

SearXNG integration for pi. Provides a composable `searx` CLI, a `/searxng` TUI command, local SearXNG Docker lifecycle management, and Playwright-powered browser rendering via `playwright-core`.

## Install

```bash
pi install git:github.com/sigilmakes/pi-searxng
```

The extension symlinks `searx` into `~/.pi/agent/bin/` on session start so it is available from bash.

## Docs

- `docs/architecture.md` — component map and search/render data flow
- `docs/runtime.md` — service URLs, config paths, browser auth state, logs
- `docs/development.md` — update loop, smoke tests, editing conventions

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

searx doctor
searx config show
searx config set browserPath "$(which chromium)"
searx browser-auth "https://www.google.com/search?q=test"
searx render start / status / restart / stop
searx render-server --port 8118          # foreground debug mode

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
searx render restart
```

`browser-auth` opens a headed persistent browser profile, watches until the page looks authenticated, then saves both storage state and profile paths into `~/.pi/agent/searxng/config.json`. No tmux, no press-enter ceremony. The package does not use CAPTCHA-solving services or stealth bypass libraries.

## Playwright-backed SearXNG engines

The Docker config mounts custom offline engines:

- `duckduckgo playwright` — works; browser-rendered DDG general search
- `brave playwright` — partial; Brave rendering works but results can be sparse
- `google playwright` — enabled; works best after `searx browser-auth` creates a persistent profile

The engines call the host render server at `http://host.docker.internal:8118/render`. The extension auto-starts it when `autoStartRenderServer` is true. Manual lifecycle:

```bash
searx render start
searx render status
searx restart
searx search "rust async" -e "google playwright,duckduckgo playwright,wikipedia" --text
```

## Pi extension

`/searxng` supports: `doctor`, `status`, `start`, `stop`, `restart`, `engines`, `config`, and `render ...` lifecycle commands.

On session start it:

1. Adds the package `bin/` and `node_modules/.bin/` to PATH
2. Symlinks `searx` into `~/.pi/agent/bin/`
3. Starts SearXNG if it is not already running
4. Starts the render server if configured

## Requirements

- Docker
- Node.js
- `uvx` for markitdown fetch fallback
- Chromium/Chrome for browser rendering (`SEARX_BROWSER_PATH` can point to it)
