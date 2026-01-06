"""Module d'analyse des articles avec Claude API."""

import json
from datetime import datetime

import anthropic

from .config import ANTHROPIC_API_KEY, CLAUDE_MODEL, MAX_ARTICLE_LENGTH, SUMMARY_MAX_LENGTH
from .database import get_all_preferences, get_unanalyzed_articles, update_article


def get_client() -> anthropic.Anthropic:
    """Crée un client Anthropic."""
    if not ANTHROPIC_API_KEY:
        raise ValueError(
            "ANTHROPIC_API_KEY non définie. "
            "Définissez la variable d'environnement ou créez un fichier .env"
        )
    return anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def build_preference_context() -> str:
    """Construit le contexte des préférences utilisateur pour le prompt."""
    preferences = get_all_preferences()

    if not preferences:
        return ""

    likes = [p.value for p in preferences if p.preference_type == "like"]
    dislikes = [p.value for p in preferences if p.preference_type == "dislike"]
    topics = [p.value for p in preferences if p.preference_type == "topic"]

    context_parts = []

    if likes:
        context_parts.append(f"L'utilisateur apprécie : {', '.join(likes)}")

    if dislikes:
        context_parts.append(f"L'utilisateur n'apprécie pas : {', '.join(dislikes)}")

    if topics:
        context_parts.append(f"Sujets d'intérêt : {', '.join(topics)}")

    return "\n".join(context_parts)


def analyze_article(article, theme_keywords: list[str] | None = None) -> dict:
    """
    Analyse un article avec Claude et retourne les résultats.

    Retourne:
        {
            "summary": str,
            "key_points": list[str],
            "tags": list[str],
            "relevance_score": float (0.0 à 1.0)
        }
    """
    client = get_client()

    # Préparer le contenu (tronquer si nécessaire)
    content = article.content or ""
    if len(content) > MAX_ARTICLE_LENGTH:
        content = content[:MAX_ARTICLE_LENGTH] + "..."

    # Construire le contexte des préférences
    pref_context = build_preference_context()

    # Construire le prompt
    system_prompt = """Tu es un assistant spécialisé dans l'analyse d'articles de veille technologique.
Tu dois analyser l'article fourni et produire :
1. Un résumé concis (2-3 phrases, max 300 caractères)
2. Les points clés (3-5 points importants)
3. Des tags pertinents (3-7 mots-clés)
4. Un score de pertinence de 0.0 à 1.0

Réponds UNIQUEMENT en JSON valide avec cette structure exacte :
{
    "summary": "...",
    "key_points": ["point 1", "point 2", ...],
    "tags": ["tag1", "tag2", ...],
    "relevance_score": 0.X
}"""

    user_prompt = f"""Analyse cet article :

Titre : {article.title}

Contenu :
{content}

"""

    if theme_keywords:
        user_prompt += f"\nMots-clés du thème : {', '.join(theme_keywords)}\n"

    if pref_context:
        user_prompt += f"\nPréférences de l'utilisateur :\n{pref_context}\n"

    user_prompt += "\nRéponds en JSON uniquement."

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )

        # Extraire le JSON de la réponse
        response_text = response.content[0].text

        # Nettoyer la réponse si nécessaire
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0]
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0]

        result = json.loads(response_text.strip())

        # Valider et normaliser le score
        score = result.get("relevance_score", 0.5)
        result["relevance_score"] = max(0.0, min(1.0, float(score)))

        # Tronquer le résumé si nécessaire
        if len(result.get("summary", "")) > SUMMARY_MAX_LENGTH:
            result["summary"] = result["summary"][:SUMMARY_MAX_LENGTH] + "..."

        return result

    except json.JSONDecodeError as e:
        print(f"Erreur de parsing JSON pour l'article {article.id}: {e}")
        return {
            "summary": "Erreur lors de l'analyse",
            "key_points": [],
            "tags": [],
            "relevance_score": 0.5,
        }
    except anthropic.APIError as e:
        print(f"Erreur API Claude pour l'article {article.id}: {e}")
        raise


def analyze_all_pending(limit: int = 50) -> int:
    """
    Analyse tous les articles en attente.

    Retourne le nombre d'articles analysés.
    """
    articles = get_unanalyzed_articles(limit=limit)

    if not articles:
        print("Aucun article à analyser.")
        return 0

    print(f"Analyse de {len(articles)} articles...")

    analyzed_count = 0

    for article in articles:
        print(f"  Analyse de : {article.title[:60]}...")

        try:
            # Récupérer les mots-clés du thème si disponible
            theme_keywords = []
            if article.source and article.source.theme:
                keywords_json = article.source.theme.keywords
                if keywords_json:
                    theme_keywords = json.loads(keywords_json)

            result = analyze_article(article, theme_keywords)

            # Mettre à jour l'article
            update_article(
                article.id,
                summary=result["summary"],
                key_points=result["key_points"],
                tags=result["tags"],
                relevance_score=result["relevance_score"],
                analyzed_at=datetime.utcnow(),
            )

            analyzed_count += 1
            print(f"    → Score: {result['relevance_score']:.2f}")

        except Exception as e:
            print(f"    → Erreur: {e}")

    return analyzed_count


def generate_daily_digest(theme_id: int | None = None) -> str:
    """Génère un résumé quotidien des articles."""
    from .database import get_recent_articles

    articles = get_recent_articles(days=1, limit=20)

    if not articles:
        return "Aucun article récent à résumer."

    # Filtrer par thème si spécifié
    if theme_id:
        articles = [a for a in articles if a.source.theme_id == theme_id]

    if not articles:
        return "Aucun article pour ce thème aujourd'hui."

    client = get_client()

    # Préparer les résumés des articles
    articles_text = "\n\n".join(
        [f"- {a.title}\n  Résumé: {a.summary or 'Non analysé'}" for a in articles[:15]]
    )

    prompt = f"""Voici les articles de veille du jour :

{articles_text}

Génère un digest concis (5-10 lignes) qui :
1. Identifie les tendances principales
2. Met en avant les informations les plus importantes
3. Suggère des connexions entre les sujets

Réponds de manière claire et structurée en français."""

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    return response.content[0].text
