# SPDX-License-Identifier: AGPL-3.0-or-later
"""DuckDuckGo via Playwright render server."""

from urllib.parse import urlencode
from searx.result_types import EngineResults
from pw_common import render, generic_h3_results, generic_anchor_results, first_nonempty

engine_type = "offline"
categories = ["general", "web"]
paging = True
timeout = 30.0

about = {
    "website": "https://duckduckgo.com",
    "wikidata_id": "Q12805",
    "official_api_documentation": "https://duckduckgo.com/api",
    "use_official_api": False,
    "require_api_key": False,
    "results": "HTML rendered by Playwright",
}


def search(query, params):
    page = int(params.get("pageno", 1))
    offset = (page - 1) * 10
    qs = {"q": query, "ia": "web"}
    if offset:
        qs["s"] = str(offset)
    url = "https://duckduckgo.com/?" + urlencode(qs)
    html = render(url, wait=3, timeout=25)
    return first_nonempty(
        generic_h3_results(html, ["duckduckgo.com"]),
        generic_anchor_results(html, ["duckduckgo.com"]),
        EngineResults(),
    )
