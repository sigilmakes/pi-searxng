# pi-searxng

SearXNG integration for [pi](https://pi.dev) — composable search primitives for the agent harness.

## Architecture

Following the **Search as Code** principle: search primitives must be programmable and composable, not locked behind monolithic tool calls.

| Layer | Interface | Purpose |
|-------|-----------|---------|
| **CLI** | `searx` binary | Composable from bash: pipe, chain, loop, filter with jq |
| **Skill** | `/search` SKILL.md | Teaches the shade how to use the CLI and direct API |
| **Extension** | `/searxng` command | TUI management: status, start, stop, restart, engines |
| **Service** | Docker Compose | Self-hosted SearXNG with local Valkey cache |

The shade uses `searx search` and `searx fetch` from bash — the same composability Perplexity's SaC architecture provides via SDK, but in the shade's native sandbox (bash).

## Installation

```bash
pi install /path/to/pi-searxng
```

## The `searx` CLI

### Search

```bash
searx search "query"                     # JSON, 8 results (default)
searx search "query" --text              # Human-readable
searx search "query" --json              # Raw SearXNG response (pipe to jq)
searx search "query" -c it               # IT/tech category
searx search "query" -c news -t week    # Recent news
searx search "query" -e wikipedia,mdn   # Specific engines only
searx search "query" -l en -n 3         # English, 3 results
searx search "query" -p 2               # Page 2
```

**Options:** `-c` categories, `-e` engines, `-t` time range, `-l` language, `-n` limit, `-p` page

### Fetch

```bash
searx fetch "https://example.com"             # Markdown content (JSON)
searx fetch "https://example.com" --text      # Just the text
searx fetch "https://example.com" -n 3000     # First 3000 chars
searx fetch "https://example.com" -o 3000     # Continue from offset
```

### Service Management

```bash
searx status           # Health check
searx start            # Start SearXNG
searx stop             # Stop SearXNG
searx restart          # Restart (clears engine suspensions)
searx engines          # List engines by category
```

Add `--text` for human-readable output.

### Composition Examples

```bash
# Extract URLs
searx search "rust async" -c it -n 5 | jq -r '.results[].url'

# Chain search → fetch
URL=$(searx search "tokio" -c it -n 1 --json | jq -r '.results[0].url')
searx fetch "$URL" --text

# Search multiple categories
for cat in general news; do searx search "climate" -c $cat -n 2 --text; done

# Filter with jq
searx search "python asyncio" -c it --json | jq '[.results[] | select(.engines | contains(["stackoverflow"]))]'

# Paginate long documents
searx fetch "$URL" -n 5000 --text
searx fetch "$URL" -n 5000 -o 5000 --text
```

## Pi Extension

The `/searxng` command provides TUI management:

- `/searxng` or `/searxng status` — service health and engine status
- `/searxng start` / `stop` / `restart` — lifecycle management
- `/searxng engines` — list enabled engines by category

## Prerequisites

- **Docker** — SearXNG runs as a Docker container
- **uvx** — For `searx fetch` (uses markitdown via uvx)

SearXNG runs on `localhost:8042` (configurable via `SEARXNG_URL` env var).

## Configuration

```
docker/docker-compose.yaml       — Docker service definition
docker/searxng/settings.yml      — Server config, formats, redis
docker/searxng/limiter.toml     — Rate limiting (disabled for local use)
```

## License

MIT