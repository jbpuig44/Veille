"""Configuration de l'application Veille."""

import os
from pathlib import Path

# Répertoires
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = Path(os.getenv("VEILLE_DATA_DIR", BASE_DIR / "data"))
SITE_DIR = Path(os.getenv("VEILLE_SITE_DIR", BASE_DIR / "site"))
TEMPLATES_DIR = BASE_DIR / "templates"

# Base de données
DATABASE_PATH = DATA_DIR / "veille.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# API Claude
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = "claude-sonnet-4-20250514"

# Paramètres de récupération
MAX_ARTICLES_PER_SOURCE = 20
REQUEST_TIMEOUT = 30
USER_AGENT = "Veille/0.1.0 (News Aggregator)"

# Paramètres d'analyse
MAX_ARTICLE_LENGTH = 15000  # Caractères max pour l'analyse
SUMMARY_MAX_LENGTH = 300

# Créer les répertoires si nécessaire
DATA_DIR.mkdir(parents=True, exist_ok=True)
SITE_DIR.mkdir(parents=True, exist_ok=True)
(SITE_DIR / "data").mkdir(exist_ok=True)
(SITE_DIR / "css").mkdir(exist_ok=True)
(SITE_DIR / "js").mkdir(exist_ok=True)
