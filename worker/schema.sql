-- Schéma de base de données pour Veille
-- Compatible Cloudflare D1 (SQLite)

-- Thèmes de veille
CREATE TABLE IF NOT EXISTS themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    keywords TEXT, -- JSON array
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Sources de news
CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    feed_url TEXT,
    source_type TEXT DEFAULT 'rss', -- rss, web, api
    is_active INTEGER DEFAULT 1,
    is_suggested INTEGER DEFAULT 0,
    quality_score REAL DEFAULT 0.5,
    last_fetched_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

-- Articles
CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    content TEXT,
    author TEXT,
    published_at TEXT,
    fetched_at TEXT DEFAULT (datetime('now')),
    -- Analyse IA
    summary TEXT,
    key_points TEXT, -- JSON array
    tags TEXT, -- JSON array
    relevance_score REAL,
    analyzed_at TEXT,
    -- Feedback utilisateur
    is_read INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    is_hidden INTEGER DEFAULT 0,
    user_rating INTEGER, -- -1, 0, 1
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Préférences utilisateur
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preference_type TEXT NOT NULL, -- like, dislike, topic
    value TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Sources suggérées par l'IA
CREATE TABLE IF NOT EXISTS suggested_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    feed_url TEXT,
    description TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending', -- pending, accepted, rejected
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

-- Index pour les performances
CREATE INDEX IF NOT EXISTS idx_articles_source_id ON articles(source_id);
CREATE INDEX IF NOT EXISTS idx_articles_fetched_at ON articles(fetched_at);
CREATE INDEX IF NOT EXISTS idx_articles_relevance ON articles(relevance_score);
CREATE INDEX IF NOT EXISTS idx_sources_theme_id ON sources(theme_id);
CREATE INDEX IF NOT EXISTS idx_suggested_sources_status ON suggested_sources(status);
