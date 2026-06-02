# SPDX-License-Identifier: AGPL-3.0-or-later
"""Google via Playwright render server."""

from urllib.parse import urlencode
from searx.result_types import EngineResults
from searx.engines.pw_common import render, generic_h3_results, generic_anchor_results, first_nonempty

engine_type = "offline"
categories = ["general", "web"]
paging = True
time_range_support = True
timeout = 30.0

about = {
    "website": "https://www.google.com",
    "wikidata_id": "Q9366",
    "official_api_documentation": "https://developers.google.com/custom-search/",
    "use_official_api": False,
    "require_api_key": False,
    "results": "HTML rendered by Playwright",
}

TIME = {"day": "d", "week": "w", "month": "m", "year": "y"}


def search(query, params):
    page = int(params.get("pageno", 1))
    start = (page - 1) * 10
    qs = {"q": query, "num": "10", "start": str(start), "hl": "en", "filter": "0"}
    if params.get("time_range") in TIME:
        qs["tbs"] = "qdr:" + TIME[params["time_range"]]
    url = "https://www.google.com/search?" + urlencode(qs)
    html = render(url, wait=2, timeout=25)
    return first_nonempty(
        generic_h3_results(html, ["google.", "gstatic.com"]),
        generic_anchor_results(html, ["google.", "gstatic.com"]),
        EngineResults(),
    )
