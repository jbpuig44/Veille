"""Générateur de site statique pour Veille."""

import json
import shutil
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from .config import SITE_DIR, TEMPLATES_DIR
from .database import (
    get_all_themes,
    get_articles_by_theme,
    get_favorite_articles,
    get_pending_suggestions,
    get_recent_articles,
    get_sources_by_theme,
)


def get_jinja_env() -> Environment:
    """Crée l'environnement Jinja2."""
    return Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=True,
    )


def format_date(dt: datetime | None) -> str:
    """Formate une date pour l'affichage."""
    if not dt:
        return "Date inconnue"
    return dt.strftime("%d/%m/%Y %H:%M")


def format_score(score: float | None) -> str:
    """Formate un score de pertinence."""
    if score is None:
        return "N/A"
    return f"{score * 100:.0f}%"


def article_to_dict(article) -> dict:
    """Convertit un article en dictionnaire pour JSON/template."""
    key_points = []
    if article.key_points:
        try:
            key_points = json.loads(article.key_points)
        except json.JSONDecodeError:
            pass

    tags = []
    if article.tags:
        try:
            tags = json.loads(article.tags)
        except json.JSONDecodeError:
            pass

    return {
        "id": article.id,
        "title": article.title,
        "url": article.url,
        "summary": article.summary or "Non analysé",
        "key_points": key_points,
        "tags": tags,
        "relevance_score": article.relevance_score,
        "relevance_display": format_score(article.relevance_score),
        "published_at": article.published_at.isoformat() if article.published_at else None,
        "published_display": format_date(article.published_at),
        "source_name": article.source.name if article.source else "Inconnu",
        "theme_name": article.source.theme.name if article.source and article.source.theme else "Inconnu",
        "theme_id": article.source.theme_id if article.source else None,
        "is_favorite": article.is_favorite,
        "user_rating": article.user_rating,
    }


def theme_to_dict(theme) -> dict:
    """Convertit un thème en dictionnaire."""
    keywords = []
    if theme.keywords:
        try:
            keywords = json.loads(theme.keywords)
        except json.JSONDecodeError:
            pass

    return {
        "id": theme.id,
        "name": theme.name,
        "description": theme.description or "",
        "keywords": keywords,
    }


def source_to_dict(source) -> dict:
    """Convertit une source en dictionnaire."""
    return {
        "id": source.id,
        "name": source.name,
        "url": source.url,
        "feed_url": source.feed_url,
        "quality_score": source.quality_score,
        "quality_display": format_score(source.quality_score),
        "is_active": source.is_active,
        "last_fetched": format_date(source.last_fetched_at),
    }


def suggestion_to_dict(suggestion) -> dict:
    """Convertit une suggestion en dictionnaire."""
    return {
        "id": suggestion.id,
        "name": suggestion.name,
        "url": suggestion.url,
        "feed_url": suggestion.feed_url,
        "description": suggestion.description or "",
        "reason": suggestion.reason or "",
        "theme_name": suggestion.theme.name if suggestion.theme else "Inconnu",
        "theme_id": suggestion.theme_id,
    }


def generate_json_data():
    """Génère les fichiers JSON pour le site."""
    data_dir = SITE_DIR / "data"
    data_dir.mkdir(exist_ok=True)

    # Données des thèmes
    themes = get_all_themes()
    themes_data = [theme_to_dict(t) for t in themes]

    with open(data_dir / "themes.json", "w", encoding="utf-8") as f:
        json.dump(themes_data, f, ensure_ascii=False, indent=2)

    # Articles récents (tous thèmes)
    recent_articles = get_recent_articles(days=7, limit=100)
    recent_data = [article_to_dict(a) for a in recent_articles]

    with open(data_dir / "recent.json", "w", encoding="utf-8") as f:
        json.dump(recent_data, f, ensure_ascii=False, indent=2)

    # Articles par thème
    for theme in themes:
        articles = get_articles_by_theme(theme.id, limit=100)
        articles_data = [article_to_dict(a) for a in articles]

        with open(data_dir / f"theme_{theme.id}.json", "w", encoding="utf-8") as f:
            json.dump(articles_data, f, ensure_ascii=False, indent=2)

        # Sources du thème
        sources = get_sources_by_theme(theme.id)
        sources_data = [source_to_dict(s) for s in sources]

        with open(data_dir / f"sources_{theme.id}.json", "w", encoding="utf-8") as f:
            json.dump(sources_data, f, ensure_ascii=False, indent=2)

    # Favoris
    favorites = get_favorite_articles()
    favorites_data = [article_to_dict(a) for a in favorites]

    with open(data_dir / "favorites.json", "w", encoding="utf-8") as f:
        json.dump(favorites_data, f, ensure_ascii=False, indent=2)

    # Suggestions en attente
    suggestions = get_pending_suggestions()
    suggestions_data = [suggestion_to_dict(s) for s in suggestions]

    with open(data_dir / "suggestions.json", "w", encoding="utf-8") as f:
        json.dump(suggestions_data, f, ensure_ascii=False, indent=2)

    # Métadonnées
    metadata = {
        "generated_at": datetime.utcnow().isoformat(),
        "total_themes": len(themes),
        "total_recent_articles": len(recent_articles),
        "total_suggestions": len(suggestions),
    }

    with open(data_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"Données JSON générées dans {data_dir}")


def copy_static_assets():
    """Copie les assets statiques (CSS, JS) vers le site."""
    # Les assets sont déjà dans site/css et site/js
    # Cette fonction peut être utilisée pour copier des assets supplémentaires
    pass


def build_site():
    """Génère le site statique complet."""
    print("Génération du site statique...")

    # S'assurer que les répertoires existent
    SITE_DIR.mkdir(exist_ok=True)
    (SITE_DIR / "data").mkdir(exist_ok=True)
    (SITE_DIR / "css").mkdir(exist_ok=True)
    (SITE_DIR / "js").mkdir(exist_ok=True)

    # Générer les données JSON
    generate_json_data()

    # Copier les assets
    copy_static_assets()

    print(f"Site généré dans {SITE_DIR}")
    return True
