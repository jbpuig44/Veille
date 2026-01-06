# Veille - Agrégateur de News Intelligent

Agrégateur de news avec analyse IA utilisant Claude API. Récupère automatiquement les articles de vos sources, les analyse pour en extraire les points clés, et génère un site statique pour la consultation.

## Fonctionnalités

- **Gestion des thèmes** : Organisez vos sources par thème (LLM IA, Impression 3D, etc.)
- **Récupération automatique** : Flux RSS et scraping web
- **Analyse IA** : Résumés, points clés, tags et score de pertinence via Claude
- **Recherche de sources** : L'IA vous suggère des sources pertinentes
- **Feedback utilisateur** : Notez les articles pour affiner les recommandations
- **Site statique** : Interface web déployable sur Cloudflare Pages

## Installation

```bash
# Cloner le repo
git clone <repo-url>
cd Veille

# Créer un environnement virtuel
python -m venv venv
source venv/bin/activate  # Linux/Mac
# ou: venv\Scripts\activate  # Windows

# Installer les dépendances
pip install -e .

# Configurer la clé API Claude
export ANTHROPIC_API_KEY="votre-clé-api"
# ou créer un fichier .env avec ANTHROPIC_API_KEY=votre-clé
```

## Utilisation

### Commandes principales

```bash
# Exécuter le pipeline complet (fetch + analyze + build)
veille run

# Commandes individuelles
veille fetch              # Récupérer les nouveaux articles
veille analyze            # Analyser avec Claude
veille build              # Générer le site statique
```

### Gestion des thèmes

```bash
veille theme list
veille theme add "LLM IA" --keywords "GPT,Claude,LLM,transformer"
veille theme edit 1 --name "Intelligence Artificielle"
veille theme delete 1
```

### Gestion des sources

```bash
veille source list
veille source add https://example.com/feed.xml --theme "LLM IA"
veille source search "Impression 3D"  # Recherche IA de sources
veille source toggle 1                # Activer/désactiver
veille source delete 1
```

### Sources suggérées par l'IA

```bash
veille suggest list           # Voir les suggestions
veille suggest accept 1       # Accepter une suggestion
veille suggest reject 1       # Rejeter
veille suggest accept-all     # Tout accepter
```

### Articles

```bash
veille article list --theme "LLM IA"
veille article rate 1 up      # Noter positivement
veille article rate 1 down    # Noter négativement
veille article digest         # Générer un digest quotidien
```

### Import/Export

```bash
veille export-data backup.json
veille import-feedback feedback.json  # Importer depuis le site web
```

## Déploiement Cloudflare Pages

1. Connectez votre repo GitHub à Cloudflare Pages
2. Configuration du build :
   - **Build command** : (laisser vide)
   - **Build output directory** : `site`
3. Chaque fois que vous exécutez `veille run`, committez et pushez les changements du dossier `site/`

### Protection par authentification (optionnel)

Pour rendre le site privé avec Cloudflare Access :
1. Allez dans Cloudflare Zero Trust > Access > Applications
2. Créez une application pour votre domaine Pages
3. Configurez la politique d'accès (email, GitHub, etc.)

## Structure du projet

```
Veille/
├── veille/                 # Package Python
│   ├── cli.py              # Interface en ligne de commande
│   ├── config.py           # Configuration
│   ├── models.py           # Modèles SQLAlchemy
│   ├── database.py         # Opérations CRUD
│   ├── fetcher.py          # Récupération RSS/web
│   ├── analyzer.py         # Analyse IA avec Claude
│   ├── source_finder.py    # Recherche de sources IA
│   └── builder.py          # Génération du site statique
├── site/                   # Site statique (à déployer)
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── data/               # Données JSON générées
├── data/                   # Base SQLite (local)
├── pyproject.toml
└── README.md
```

## Workflow recommandé

```bash
# 1. Créer vos thèmes
veille theme add "LLM IA" -k "GPT,Claude,LLM,AI"
veille theme add "Impression 3D" -k "3D printing,FDM,SLA"

# 2. Chercher des sources via IA
veille source search "LLM IA"
veille suggest list
veille suggest accept-all

# 3. Lancer le pipeline quotidien
veille run

# 4. Déployer
git add site/
git commit -m "Update news"
git push

# 5. Consulter le site et donner vos feedbacks
# 6. Importer les feedbacks
veille import-feedback ~/Downloads/veille_feedback_*.json
```

## Configuration

Variables d'environnement :

| Variable | Description | Défaut |
|----------|-------------|--------|
| `ANTHROPIC_API_KEY` | Clé API Claude (requise) | - |
| `VEILLE_DATA_DIR` | Répertoire des données | `./data` |
| `VEILLE_SITE_DIR` | Répertoire du site | `./site` |

## Licence

MIT
