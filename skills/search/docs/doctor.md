# Search Skill: Doctor

Run this before the first search in a session:

```bash
searx doctor --text
```

## How to read it

- `SearXNG: running` — the local Docker service is reachable.
- `Render server: healthy` — Playwright-backed SearXNG engines can call the host renderer.
- `Browser: available (...)` — Playwright can launch bundled Chromium or a configured browser override.
- `Browser profile: present (...)` — persistent human-auth profile exists; Google Playwright is usually safe to use.
- `Browser profile: absent (...)` — Google may serve challenge pages. Use DDG/Wikipedia unless Google matters.
- `Recommended search: ...` — the command the agent should copy for default general search.

## Fixes

```bash
searx start                 # SearXNG not responding
searx render start          # render server stopped
searx render restart        # render server stale after auth/config change
searx config set browserPath "$(which chromium)"  # optional browser override if bundled Chromium cannot launch
```

After any fix, run `searx doctor --text` again. Trust current diagnostics over memory.
