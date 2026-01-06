"""Gestion de la base de données et opérations CRUD."""

import json
from contextlib import contextmanager
from datetime import datetime
from typing import Generator

from sqlalchemy.orm import Session, sessionmaker

from .models import (
    Article,
    Source,
    SuggestedSource,
    Theme,
    UserPreference,
    get_engine,
    init_db,
)


# Session factory
SessionLocal = sessionmaker(bind=get_engine())


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Context manager pour obtenir une session de base de données."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ============ Thèmes ============


def create_theme(name: str, description: str = "", keywords: list[str] | None = None) -> Theme:
    """Crée un nouveau thème."""
    with get_session() as session:
        theme = Theme(
            name=name,
            description=description,
            keywords=json.dumps(keywords or []),
        )
        session.add(theme)
        session.flush()
        theme_id = theme.id
    return get_theme(theme_id)


def get_theme(theme_id: int) -> Theme | None:
    """Récupère un thème par son ID."""
    with get_session() as session:
        return session.get(Theme, theme_id)


def get_theme_by_name(name: str) -> Theme | None:
    """Récupère un thème par son nom."""
    with get_session() as session:
        return session.query(Theme).filter(Theme.name == name).first()


def get_all_themes(active_only: bool = True) -> list[Theme]:
    """Récupère tous les thèmes."""
    with get_session() as session:
        query = session.query(Theme)
        if active_only:
            query = query.filter(Theme.is_active == True)  # noqa: E712
        return query.order_by(Theme.name).all()


def update_theme(theme_id: int, **kwargs) -> Theme | None:
    """Met à jour un thème."""
    with get_session() as session:
        theme = session.get(Theme, theme_id)
        if theme:
            for key, value in kwargs.items():
                if key == "keywords" and isinstance(value, list):
                    value = json.dumps(value)
                setattr(theme, key, value)
    return get_theme(theme_id)


def delete_theme(theme_id: int) -> bool:
    """Supprime un thème."""
    with get_session() as session:
        theme = session.get(Theme, theme_id)
        if theme:
            session.delete(theme)
            return True
    return False


# ============ Sources ============


def create_source(
    theme_id: int,
    name: str,
    url: str,
    feed_url: str | None = None,
    source_type: str = "rss",
    is_suggested: bool = False,
) -> Source:
    """Crée une nouvelle source."""
    with get_session() as session:
        source = Source(
            theme_id=theme_id,
            name=name,
            url=url,
            feed_url=feed_url or url,
            source_type=source_type,
            is_suggested=is_suggested,
        )
        session.add(source)
        session.flush()
        source_id = source.id
    return get_source(source_id)


def get_source(source_id: int) -> Source | None:
    """Récupère une source par son ID."""
    with get_session() as session:
        return session.get(Source, source_id)


def get_sources_by_theme(theme_id: int, active_only: bool = True) -> list[Source]:
    """Récupère les sources d'un thème."""
    with get_session() as session:
        query = session.query(Source).filter(Source.theme_id == theme_id)
        if active_only:
            query = query.filter(Source.is_active == True)  # noqa: E712
        return query.order_by(Source.name).all()


def get_all_sources(active_only: bool = True) -> list[Source]:
    """Récupère toutes les sources."""
    with get_session() as session:
        query = session.query(Source)
        if active_only:
            query = query.filter(Source.is_active == True)  # noqa: E712
        return query.order_by(Source.name).all()


def update_source(source_id: int, **kwargs) -> Source | None:
    """Met à jour une source."""
    with get_session() as session:
        source = session.get(Source, source_id)
        if source:
            for key, value in kwargs.items():
                setattr(source, key, value)
    return get_source(source_id)


def update_source_quality(source_id: int, rating: int):
    """Met à jour le score de qualité d'une source basé sur les feedbacks."""
    with get_session() as session:
        source = session.get(Source, source_id)
        if source:
            # Ajustement progressif du score
            adjustment = 0.05 if rating > 0 else -0.05 if rating < 0 else 0
            new_score = max(0.0, min(1.0, source.quality_score + adjustment))
            source.quality_score = new_score


def delete_source(source_id: int) -> bool:
    """Supprime une source."""
    with get_session() as session:
        source = session.get(Source, source_id)
        if source:
            session.delete(source)
            return True
    return False


# ============ Articles ============


def create_article(
    source_id: int,
    title: str,
    url: str,
    content: str | None = None,
    author: str | None = None,
    published_at: datetime | None = None,
) -> Article | None:
    """Crée un nouvel article (évite les doublons par URL)."""
    with get_session() as session:
        # Vérifier si l'article existe déjà
        existing = session.query(Article).filter(Article.url == url).first()
        if existing:
            return None

        article = Article(
            source_id=source_id,
            title=title,
            url=url,
            content=content,
            author=author,
            published_at=published_at,
        )
        session.add(article)
        session.flush()
        article_id = article.id
    return get_article(article_id)


def get_article(article_id: int) -> Article | None:
    """Récupère un article par son ID."""
    with get_session() as session:
        return session.get(Article, article_id)


def get_article_by_url(url: str) -> Article | None:
    """Récupère un article par son URL."""
    with get_session() as session:
        return session.query(Article).filter(Article.url == url).first()


def get_articles_by_source(source_id: int, limit: int = 50) -> list[Article]:
    """Récupère les articles d'une source."""
    with get_session() as session:
        return (
            session.query(Article)
            .filter(Article.source_id == source_id)
            .order_by(Article.published_at.desc())
            .limit(limit)
            .all()
        )


def get_articles_by_theme(theme_id: int, limit: int = 100) -> list[Article]:
    """Récupère les articles d'un thème."""
    with get_session() as session:
        return (
            session.query(Article)
            .join(Source)
            .filter(Source.theme_id == theme_id)
            .filter(Article.is_hidden == False)  # noqa: E712
            .order_by(Article.published_at.desc())
            .limit(limit)
            .all()
        )


def get_unanalyzed_articles(limit: int = 50) -> list[Article]:
    """Récupère les articles non analysés."""
    with get_session() as session:
        return (
            session.query(Article)
            .filter(Article.analyzed_at == None)  # noqa: E711
            .order_by(Article.fetched_at.desc())
            .limit(limit)
            .all()
        )


def get_recent_articles(days: int = 7, limit: int = 100) -> list[Article]:
    """Récupère les articles récents."""
    from datetime import timedelta

    with get_session() as session:
        cutoff = datetime.utcnow() - timedelta(days=days)
        return (
            session.query(Article)
            .filter(Article.fetched_at >= cutoff)
            .filter(Article.is_hidden == False)  # noqa: E712
            .order_by(Article.relevance_score.desc().nullslast(), Article.published_at.desc())
            .limit(limit)
            .all()
        )


def get_favorite_articles() -> list[Article]:
    """Récupère les articles favoris."""
    with get_session() as session:
        return (
            session.query(Article)
            .filter(Article.is_favorite == True)  # noqa: E712
            .order_by(Article.published_at.desc())
            .all()
        )


def update_article(article_id: int, **kwargs) -> Article | None:
    """Met à jour un article."""
    with get_session() as session:
        article = session.get(Article, article_id)
        if article:
            for key, value in kwargs.items():
                if key in ("key_points", "tags") and isinstance(value, list):
                    value = json.dumps(value)
                setattr(article, key, value)
    return get_article(article_id)


def rate_article(article_id: int, rating: int) -> Article | None:
    """Note un article (-1, 0, 1) et met à jour la source."""
    with get_session() as session:
        article = session.get(Article, article_id)
        if article:
            article.user_rating = rating
            # Mettre à jour le score de la source
            update_source_quality(article.source_id, rating)
    return get_article(article_id)


# ============ Préférences ============


def add_preference(preference_type: str, value: str, weight: float = 1.0) -> UserPreference:
    """Ajoute une préférence utilisateur."""
    with get_session() as session:
        pref = UserPreference(
            preference_type=preference_type,
            value=value,
            weight=weight,
        )
        session.add(pref)
        session.flush()
        pref_id = pref.id
    return get_preference(pref_id)


def get_preference(pref_id: int) -> UserPreference | None:
    """Récupère une préférence."""
    with get_session() as session:
        return session.get(UserPreference, pref_id)


def get_preferences_by_type(preference_type: str) -> list[UserPreference]:
    """Récupère les préférences d'un type."""
    with get_session() as session:
        return (
            session.query(UserPreference)
            .filter(UserPreference.preference_type == preference_type)
            .all()
        )


def get_all_preferences() -> list[UserPreference]:
    """Récupère toutes les préférences."""
    with get_session() as session:
        return session.query(UserPreference).all()


# ============ Sources suggérées ============


def create_suggested_source(
    theme_id: int,
    name: str,
    url: str,
    feed_url: str | None = None,
    description: str | None = None,
    reason: str | None = None,
) -> SuggestedSource:
    """Crée une source suggérée."""
    with get_session() as session:
        suggestion = SuggestedSource(
            theme_id=theme_id,
            name=name,
            url=url,
            feed_url=feed_url,
            description=description,
            reason=reason,
        )
        session.add(suggestion)
        session.flush()
        suggestion_id = suggestion.id
    return get_suggested_source(suggestion_id)


def get_suggested_source(suggestion_id: int) -> SuggestedSource | None:
    """Récupère une source suggérée."""
    with get_session() as session:
        return session.get(SuggestedSource, suggestion_id)


def get_pending_suggestions(theme_id: int | None = None) -> list[SuggestedSource]:
    """Récupère les suggestions en attente."""
    with get_session() as session:
        query = session.query(SuggestedSource).filter(SuggestedSource.status == "pending")
        if theme_id:
            query = query.filter(SuggestedSource.theme_id == theme_id)
        return query.order_by(SuggestedSource.created_at.desc()).all()


def accept_suggestion(suggestion_id: int) -> Source | None:
    """Accepte une suggestion et crée la source."""
    with get_session() as session:
        suggestion = session.get(SuggestedSource, suggestion_id)
        if suggestion and suggestion.status == "pending":
            suggestion.status = "accepted"
            # Créer la source
            source = create_source(
                theme_id=suggestion.theme_id,
                name=suggestion.name,
                url=suggestion.url,
                feed_url=suggestion.feed_url,
                is_suggested=True,
            )
            return source
    return None


def reject_suggestion(suggestion_id: int) -> bool:
    """Rejette une suggestion."""
    with get_session() as session:
        suggestion = session.get(SuggestedSource, suggestion_id)
        if suggestion and suggestion.status == "pending":
            suggestion.status = "rejected"
            return True
    return False


# ============ Initialisation ============


def initialize_database():
    """Initialise la base de données."""
    init_db()
