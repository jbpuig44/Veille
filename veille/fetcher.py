"""Module de récupération des articles depuis les sources RSS et web."""

import asyncio
from datetime import datetime
from typing import Any

import feedparser
import httpx
from dateutil import parser as date_parser

from .config import MAX_ARTICLES_PER_SOURCE, REQUEST_TIMEOUT, USER_AGENT
from .database import create_article, get_all_sources, update_source


async def fetch_url(client: httpx.AsyncClient, url: str) -> str | None:
    """Récupère le contenu d'une URL."""
    try:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        return response.text
    except httpx.HTTPError as e:
        print(f"Erreur lors de la récupération de {url}: {e}")
        return None


def parse_feed(feed_content: str) -> list[dict[str, Any]]:
    """Parse un flux RSS/Atom et retourne les articles."""
    feed = feedparser.parse(feed_content)
    articles = []

    for entry in feed.entries[:MAX_ARTICLES_PER_SOURCE]:
        # Extraire la date de publication
        published = None
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            try:
                published = datetime(*entry.published_parsed[:6])
            except (TypeError, ValueError):
                pass
        elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
            try:
                published = datetime(*entry.updated_parsed[:6])
            except (TypeError, ValueError):
                pass

        # Extraire le contenu
        content = ""
        if hasattr(entry, "content") and entry.content:
            content = entry.content[0].get("value", "")
        elif hasattr(entry, "summary"):
            content = entry.summary
        elif hasattr(entry, "description"):
            content = entry.description

        # Nettoyer le HTML basique
        content = clean_html(content)

        articles.append(
            {
                "title": entry.get("title", "Sans titre"),
                "url": entry.get("link", ""),
                "content": content,
                "author": entry.get("author", None),
                "published_at": published,
            }
        )

    return articles


def clean_html(html: str) -> str:
    """Nettoie le HTML et extrait le texte."""
    from bs4 import BeautifulSoup

    if not html:
        return ""

    soup = BeautifulSoup(html, "lxml")

    # Supprimer les scripts et styles
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    text = soup.get_text(separator=" ", strip=True)

    # Nettoyer les espaces multiples
    import re

    text = re.sub(r"\s+", " ", text)

    return text.strip()


async def fetch_full_content(client: httpx.AsyncClient, url: str) -> str | None:
    """Récupère le contenu complet d'un article via trafilatura."""
    try:
        import trafilatura

        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()

        # Extraire le contenu principal
        content = trafilatura.extract(
            response.text,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
        )

        return content
    except Exception as e:
        print(f"Erreur lors de l'extraction du contenu de {url}: {e}")
        return None


async def fetch_source(source) -> list[dict[str, Any]]:
    """Récupère les articles d'une source."""
    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        feed_url = source.feed_url or source.url

        if source.source_type == "rss":
            content = await fetch_url(client, feed_url)
            if content:
                return parse_feed(content)
        elif source.source_type == "web":
            # Pour les sources web, on utilise trafilatura
            content = await fetch_full_content(client, source.url)
            if content:
                return [
                    {
                        "title": f"Article de {source.name}",
                        "url": source.url,
                        "content": content,
                        "author": None,
                        "published_at": datetime.utcnow(),
                    }
                ]

        return []


async def fetch_all_sources(source_ids: list[int] | None = None) -> dict[int, int]:
    """
    Récupère les articles de toutes les sources actives.

    Retourne un dictionnaire {source_id: nombre_d'articles_ajoutés}
    """
    from .database import get_source

    sources = get_all_sources(active_only=True)

    if source_ids:
        sources = [s for s in sources if s.id in source_ids]

    results = {}

    for source in sources:
        print(f"Récupération de {source.name}...")

        try:
            articles = await fetch_source(source)
            added_count = 0

            for article_data in articles:
                if not article_data.get("url"):
                    continue

                article = create_article(
                    source_id=source.id,
                    title=article_data["title"],
                    url=article_data["url"],
                    content=article_data.get("content"),
                    author=article_data.get("author"),
                    published_at=article_data.get("published_at"),
                )

                if article:
                    added_count += 1

            # Mettre à jour la date de dernière récupération
            update_source(source.id, last_fetched_at=datetime.utcnow())

            results[source.id] = added_count
            print(f"  → {added_count} nouveaux articles")

        except Exception as e:
            print(f"  → Erreur: {e}")
            results[source.id] = 0

    return results


def fetch_sources_sync(source_ids: list[int] | None = None) -> dict[int, int]:
    """Version synchrone de fetch_all_sources."""
    return asyncio.run(fetch_all_sources(source_ids))


async def discover_feed_url(url: str) -> str | None:
    """Essaie de découvrir l'URL du flux RSS d'un site."""
    from bs4 import BeautifulSoup

    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        try:
            response = await client.get(url, follow_redirects=True)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "lxml")

            # Chercher les liens RSS/Atom dans le head
            feed_links = soup.find_all(
                "link",
                type=lambda t: t and ("rss" in t or "atom" in t),
            )

            if feed_links:
                href = feed_links[0].get("href", "")
                if href:
                    # Convertir en URL absolue si nécessaire
                    if href.startswith("/"):
                        from urllib.parse import urljoin

                        href = urljoin(url, href)
                    return href

            # Essayer des URLs communes
            common_paths = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"]
            from urllib.parse import urljoin

            for path in common_paths:
                feed_url = urljoin(url, path)
                try:
                    resp = await client.get(feed_url)
                    if resp.status_code == 200 and (
                        "xml" in resp.headers.get("content-type", "")
                        or resp.text.strip().startswith("<?xml")
                    ):
                        return feed_url
                except httpx.HTTPError:
                    continue

        except httpx.HTTPError as e:
            print(f"Erreur lors de la découverte du flux pour {url}: {e}")

    return None


def discover_feed_sync(url: str) -> str | None:
    """Version synchrone de discover_feed_url."""
    return asyncio.run(discover_feed_url(url))
