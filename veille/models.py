"""Modèles de données SQLAlchemy pour Veille."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .config import DATABASE_URL


class Base(DeclarativeBase):
    """Classe de base pour tous les modèles."""

    pass


class Theme(Base):
    """Un thème de veille (ex: LLM IA, Impression 3D)."""

    __tablename__ = "themes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    keywords: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relations
    sources: Mapped[list["Source"]] = relationship("Source", back_populates="theme")

    def __repr__(self) -> str:
        return f"<Theme(id={self.id}, name='{self.name}')>"


class Source(Base):
    """Une source de news (flux RSS, site web)."""

    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    theme_id: Mapped[int] = mapped_column(Integer, ForeignKey("themes.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    feed_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    source_type: Mapped[str] = mapped_column(String(20), default="rss")  # rss, web, api
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_suggested: Mapped[bool] = mapped_column(Boolean, default=False)  # Suggéré par l'IA
    quality_score: Mapped[float] = mapped_column(Float, default=0.5)  # 0.0 à 1.0
    last_fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relations
    theme: Mapped["Theme"] = relationship("Theme", back_populates="sources")
    articles: Mapped[list["Article"]] = relationship("Article", back_populates="source")

    def __repr__(self) -> str:
        return f"<Source(id={self.id}, name='{self.name}')>"


class Article(Base):
    """Un article récupéré depuis une source."""

    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(Integer, ForeignKey("sources.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    author: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Analyse IA
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    key_points: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list
    tags: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list
    relevance_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 0.0 à 1.0
    analyzed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Feedback utilisateur
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    user_rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # -1, 0, 1

    # Relations
    source: Mapped["Source"] = relationship("Source", back_populates="articles")

    def __repr__(self) -> str:
        return f"<Article(id={self.id}, title='{self.title[:50]}...')>"


class UserPreference(Base):
    """Préférences utilisateur pour l'apprentissage."""

    __tablename__ = "user_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    preference_type: Mapped[str] = mapped_column(String(50), nullable=False)  # like, dislike, topic
    value: Mapped[str] = mapped_column(Text, nullable=False)
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def __repr__(self) -> str:
        return f"<UserPreference(type='{self.preference_type}', value='{self.value[:30]}')>"


class SuggestedSource(Base):
    """Sources suggérées par l'IA, en attente de validation."""

    __tablename__ = "suggested_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    theme_id: Mapped[int] = mapped_column(Integer, ForeignKey("themes.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    feed_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Pourquoi l'IA suggère
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, accepted, rejected
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relations
    theme: Mapped["Theme"] = relationship("Theme")

    def __repr__(self) -> str:
        return f"<SuggestedSource(name='{self.name}', status='{self.status}')>"


# Création du moteur et des tables
engine = create_engine(DATABASE_URL, echo=False)


def init_db():
    """Initialise la base de données."""
    Base.metadata.create_all(engine)


def get_engine():
    """Retourne le moteur de base de données."""
    return engine
