# pi-searxng

SearXNG integration for pi. Provides a CLI for web search and page fetching, a `/searxng` command for TUI management, and a skill teaching composability.

## Install

```bash
pi install git:github.com/sigilmakes/pi-searxng
```

## CLI

```bash
searx search "query"                     # JSON results (default)
searx search "query" --text              # Human-readable
searx search "query" -c it -n 3         # IT category, 3 results
searx search "query" -c news -t week    # Recent news
searx search "query" -e wikipedia,mdn   # Specific engines
searx search "query" --json | jq '.'   # Raw SearXNG response

searx fetch "https://example.com"        # Page as markdown (JSON)
searx fetch "https://example.com" --text # Just the text
searx fetch "$URL" -n 3000 -o 3000      # Paginate long documents

searx status / start / stop / restart    # Service management
searx engines                            # List engines by category
```

All output is JSON by default. Add `--text` for human-readable. Pipe to `jq` for filtering.

## Pi Extension

`/searxng` — status, start, stop, restart, engines from the TUI.

## Requirements

- Docker (SearXNG runs as a container)
- uvx (for `searx fetch`, uses markitdown)