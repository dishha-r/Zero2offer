import ipaddress
import json
import logging
import os
import socket
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger("zero2offer.jobs")

MAX_REDIRECTS = 3
MAX_BYTES = 500_000  # max page size we will download
MAX_CHARS = 3000  # max text passed to the LLM per job


def _is_public_url(url: str) -> bool:
    """Allow only http(s) URLs that resolve to public IP addresses."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        for info in socket.getaddrinfo(parsed.hostname, None):
            if not ipaddress.ip_address(info[4][0]).is_global:
                return False
        return True
    except Exception:
        return False


def _pick_link(job: dict):
    for opt in job.get("apply_options") or []:
        if opt.get("link"):
            return opt["link"]
    if job.get("share_link"):
        return job["share_link"]
    for rel in job.get("related_links") or []:
        if rel.get("link"):
            return rel["link"]
    return None


def search_jobs(target_role: str, location: str = "Remote") -> str:
    """Search Google Jobs (via SerpAPI) and return JSON with apply links."""
    api_key = os.getenv("SERPAPI_KEY")
    if not api_key:
        return json.dumps(
            {"error": "Live job search isn't set up on this server, so no listings are available right now."}
        )

    params = {"engine": "google_jobs", "q": target_role, "hl": "en", "api_key": api_key}
    # Google Jobs fails when location is "Remote", so put it in the query instead
    if location.strip().lower() == "remote":
        params["q"] = f"{target_role} remote"
    else:
        params["location"] = location

    try:
        response = requests.get("https://serpapi.com/search", params=params, timeout=15)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        # Log only the error type: the message can contain the URL with the API key
        logger.warning("Job search failed (%s)", type(e).__name__)
        return json.dumps({"error": "Job search is temporarily unavailable."})

    jobs = [
        {
            "title": job.get("title", "Unknown Title"),
            "company": job.get("company_name", "Unknown Company"),
            "location": job.get("location", "Location not specified"),
            "apply_link": _pick_link(job),
        }
        for job in data.get("jobs_results", [])[:5]
    ]
    if not jobs:
        return json.dumps({"jobs": [], "note": "No matching listings found."})
    return json.dumps({"jobs": jobs})


def fetch_job_description(url: str) -> str:
    """Fetch a public job page and return its text (first few thousand characters)."""
    if not isinstance(url, str):
        return "Error: url must be a string."

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        if not _is_public_url(current):
            return "Could not fetch: only public http(s) URLs are allowed."
        try:
            with requests.get(
                current, headers=headers, timeout=10, stream=True, allow_redirects=False
            ) as resp:
                if resp.is_redirect:
                    # Follow redirects manually so every hop is checked
                    current = urljoin(current, resp.headers.get("Location", ""))
                    continue
                resp.raise_for_status()
                body = b""
                for chunk in resp.iter_content(65536):
                    body += chunk
                    if len(body) >= MAX_BYTES:
                        break
        except requests.RequestException as e:
            logger.warning("Job page fetch failed (%s)", type(e).__name__)
            return "Could not extract the job description from that page."

        soup = BeautifulSoup(body.decode("utf-8", errors="replace"), "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)[:MAX_CHARS]

    return "Could not fetch: too many redirects."


def fetch_multiple_job_descriptions(urls_json: str) -> str:
    """Fetch descriptions for up to 3 job URLs (JSON list) in one call."""
    try:
        urls = json.loads(urls_json)
    except json.JSONDecodeError:
        return "Error: Invalid JSON format for URLs."
    if not isinstance(urls, list) or not all(isinstance(u, str) for u in urls):
        return "Error: urls_json must be a JSON list of strings."

    parts = []
    for i, url in enumerate(urls[:3], start=1):
        parts.append(f"--- JOB {i} URL: {url} ---\n{fetch_job_description(url)}\n")
    return "\n\n".join(parts)