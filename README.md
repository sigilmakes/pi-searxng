# pi-searxng

SearXNG integration for [pi](https://pi.dev) — web search and fetch tools with local instance management.

## What it provides

- **`web_search` tool** — Query SearXNG directly from the LLM with full API support (categories, engines, time ranges, language, pagination)
- **`web_fetch` tool** — Convert URLs to clean markdown via markitdown (handles HTML, PDF, DOCX, PPTX)
- **`/searxng` command** — Manage the SearXNG Docker service (start/stop/restart/status/engines)

The extension auto-starts SearXNG when needed and reports engine health issues.

## Installation

```bash
pi install git:github.com/sigilmakes/pi-searxng
```

Or from a local checkout:

```bash
pi install /path/to/pi-searxng
```

## Prerequisites

- **Docker** — The extension manages a SearXNG container via `docker compose`
- **uvx** — For `web_fetch` (uses `markitdown` via `uvx`)
- SearXNG runs on `localhost:8042` (configurable via `SEARXNG_URL` env var)

## Tools

### web_search

| Parameter    | Type   | Description                                                       |
| ------------ | ------ | ----------------------------------------------------------------- |
| `query`      | string | Search query (required)                                           |
| `categories` | string | SearXNG categories: general, news, images, it, science, etc.      |
| `engines`    | string | Specific engines: google, brave, wikipedia, stackoverflow, etc.   |
| `time_range` | enum   | `day`, `week`, `month`, `year`                                    |
| `language`   | string | Result language code: en, de, fr, etc.                           |
| `pageno`     | number | Page number for pagination                                        |
| `limit`      | number | Max results (1–20, default 8)                                    |

### web_fetch

| Parameter    | Type   | Description                                         |
| ------------ | ------ | --------------------------------------------------- |
| `url`        | string | URL to fetch (required)                             |
| `max_length` | number | Maximum characters to return (default 5000)        |
| `offset`     | number | Character offset for paginating long documents     |

## Commands

- `/searxng` or `/searxng status` — Show service status and engine health
- `/searxng start` — Start the SearXNG container
- `/searxng stop` — Stop the SearXNGNG container
- `/searxng restart` — Restart (clears engine suspensions)
- `/searxng engines` — List enabled engines by category

## Configuration

SearXNG configuration is in `docker/searxng/settings.yml`. The Docker Compose file is in `docker/docker-compose.yaml`.

To change the SearXNG port or other Docker settings, edit the compose file and run `/searxng restart`.

## License

MIT