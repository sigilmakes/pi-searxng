# SPDX-License-Identifier: AGPL-3.0-or-later
"""Shared helpers for Playwright-backed offline SearXNG engines."""

import json
import os
import re
import urllib.parse
import urllib.request
from lxml import html

from searx.result_types import EngineResults

RENDER_URL = os.environ.get("SEARXNG_RENDER_URL", "http://host.docker.internal:8118/render")
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def render(url, wait=2, timeout=25):
    body = json.dumps({"url": url, "wait": wait, "timeout": timeout}).encode("utf-8")
    req = urllib.request.Request(
        RENDER_URL,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout + 5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if "error" in data:
        raise RuntimeError(data["error"])
    return data.get("html", "")


def text(node):
    if node is None:
        return ""
    return " ".join(node.text_content().split())


def clean_url(url):
    if not url:
        return ""
    if url.startswith("/url?"):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        if qs.get("q"):
            return qs["q"][0]
        if qs.get("url"):
            return qs["url"][0]
    if url.startswith("//"):
        return "https:" + url
    return url


def is_good_url(url, blocked_hosts):
    if not url or not url.startswith(("http://", "https://")):
        return False
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    if any(blocked in host for blocked in blocked_hosts):
        return False
    if any(skip in url for skip in ("/preferences", "/settings", "/login", "/signin")):
        return False
    return True


def result_context(anchor):
    node = anchor
    for _ in range(5):
        parent = node.getparent()
        if parent is None:
            return node
        node = parent
    return node


def generic_h3_results(rendered_html, blocked_hosts):
    """Extract search results from pages with h3-in-anchor result cards."""
    dom = html.fromstring(rendered_html)
    results = EngineResults()
    seen = set()

    for anchor in dom.xpath('//a[@href and .//h3]'):
        url = clean_url(anchor.get("href"))
        if not is_good_url(url, blocked_hosts) or url in seen:
            continue

        title = text(anchor.xpath('.//h3')[0])
        if not title or len(title) < 3:
            continue

        ctx = result_context(anchor)
        content = text(ctx)
        content = content.replace(title, "", 1).strip()
        content = re.sub(r"\s+", " ", content)
        if len(content) > 400:
            content = content[:400].rsplit(" ", 1)[0] + "…"

        results.append({"url": url, "title": title, "content": content})
        seen.add(url)

    return results


def generic_anchor_results(rendered_html, blocked_hosts):
    """Fallback extraction for engines whose cards don't use h3."""
    dom = html.fromstring(rendered_html)
    results = EngineResults()
    seen = set()

    for anchor in dom.xpath('//a[@href]'):
        url = clean_url(anchor.get("href"))
        if not is_good_url(url, blocked_hosts) or url in seen:
            continue

        title = text(anchor)
        if len(title) < 12 or len(title) > 180:
            continue

        ctx = result_context(anchor)
        content = text(ctx).replace(title, "", 1).strip()
        if len(content) > 400:
            content = content[:400].rsplit(" ", 1)[0] + "…"

        results.append({"url": url, "title": title, "content": content})
        seen.add(url)
        if len(results) >= 10:
            break

    return results


def ddg_article_results(rendered_html):
    """DuckDuckGo rendered SERP parser.

    DDG cards are article elements with several duplicated links:
    site name, display URL, title, site filters, etc.  Prefer title-like
    links and ignore query/filter controls.
    """
    dom = html.fromstring(rendered_html)
    results = EngineResults()
    seen = set()

    for article in dom.xpath('//article[.//a[@href]]'):
        anchors = article.xpath('.//a[@href]')
        external = []
        for anchor in anchors:
            url = clean_url(anchor.get('href'))
            label = text(anchor)
            if not is_good_url(url, ['duckduckgo.com']) or url in seen:
                continue
            if ' › ' in label or label.startswith('http') or label.endswith('.com') or label.endswith('.org'):
                # display URL / site crumb, not a human title
                continue
            if len(label) < 8 or len(label) > 180:
                continue
            external.append((url, label, anchor))

        if not external:
            continue

        # choose the longest title-ish label from this article
        url, title, anchor = sorted(external, key=lambda item: len(item[1]), reverse=True)[0]
        if url in seen:
            continue

        content = text(article)
        junk_patterns = [
            r'Only include results for this site',
            r'Redo search without this site',
            r'Block this site from all results',
            r'Share feedback about this site',
        ]
        for pattern in junk_patterns:
            content = re.sub(pattern, ' ', content)
        content = content.replace(title, ' ', 1)
        content = re.sub(r'\s+', ' ', content).strip()
        if len(content) > 400:
            content = content[:400].rsplit(' ', 1)[0] + '…'

        results.append({'url': url, 'title': title, 'content': content})
        seen.add(url)

    return results


def first_nonempty(*result_sets):
    for res in result_sets:
        if len(res) > 0:
            return res
    return EngineResults()
