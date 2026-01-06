"""Module de recherche de sources par IA."""

import json

import anthropic
import httpx

from .config import ANTHROPIC_API_KEY, CLAUDE_MODEL, REQUEST_TIMEOUT, USER_AGENT
from .database import create_suggested_source, get_theme
from .fetcher import discover_feed_sync


def get_client() -> anthropic.Anthropic:
    """Crée un client Anthropic."""
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY non définie.")
    return anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def search_sources_for_theme(theme_id: int, num_sources: int = 5) -> list[dict]:
    """
    Demande à Claude de suggérer des sources pour un thème.

    Retourne une liste de sources suggérées.
    """
    theme = get_theme(theme_id)
    if not theme:
        raise ValueError(f"Thème {theme_id} non trouvé")

    # Récupérer les mots-clés du thème
    keywords = []
    if theme.keywords:
        keywords = json.loads(theme.keywords)

    client = get_client()

    prompt = f"""Tu es un expert en veille technologique. Je cherche des sources d'information de qualité sur le thème "{theme.name}".

{f"Description du thème : {theme.description}" if theme.description else ""}
{f"Mots-clés associés : {', '.join(keywords)}" if keywords else ""}

Suggère {num_sources} sources de qualité (blogs, sites d'actualité, newsletters) avec flux RSS de préférence.

Pour chaque source, fournis :
- name: Nom de la source
- url: URL du site principal
- feed_url: URL du flux RSS si connu (sinon null)
- description: Brève description (1 phrase)
- reason: Pourquoi cette source est pertinente

Réponds UNIQUEMENT en JSON valide avec cette structure :
{{
    "sources": [
        {{
            "name": "...",
            "url": "...",
            "feed_url": "..." ou null,
            "description": "...",
            "reason": "..."
        }}
    ]
}}

Privilégie :
- Les sources avec contenu récent et régulier
- Les sites reconnus dans le domaine
- Les sources en français ET anglais
- Les blogs techniques d'experts"""

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    # Parser la réponse
    response_text = response.content[0].text

    # Nettoyer le JSON si nécessaire
    if "```json" in response_text:
        response_text = response_text.split("```json")[1].split("```")[0]
    elif "```" in response_text:
        response_text = response_text.split("```")[1].split("```")[0]

    try:
        result = json.loads(response_text.strip())
        return result.get("sources", [])
    except json.JSONDecodeError as e:
        print(f"Erreur de parsing JSON: {e}")
        print(f"Réponse brute: {response_text[:500]}")
        return []


def validate_source(url: str) -> dict:
    """
    Valide qu'une source est accessible et tente de trouver son flux RSS.

    Retourne:
        {
            "valid": bool,
            "feed_url": str | None,
            "title": str | None,
            "error": str | None
        }
    """
    result = {
        "valid": False,
        "feed_url": None,
        "title": None,
        "error": None,
    }

    try:
        # Vérifier que l'URL est accessible
        with httpx.Client(
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        ) as client:
            response = client.get(url)
            response.raise_for_status()

            result["valid"] = True

            # Extraire le titre de la page
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(response.text, "lxml")
            title_tag = soup.find("title")
            if title_tag:
                result["title"] = title_tag.get_text().strip()

        # Chercher le flux RSS
        feed_url = discover_feed_sync(url)
        if feed_url:
            result["feed_url"] = feed_url

    except httpx.HTTPError as e:
        result["error"] = str(e)
    except Exception as e:
        result["error"] = str(e)

    return result


def suggest_sources_for_theme(theme_id: int, num_sources: int = 5) -> list[dict]:
    """
    Recherche et valide des sources pour un thème, puis les enregistre comme suggestions.

    Retourne la liste des sources suggérées créées.
    """
    print(f"Recherche de sources pour le thème {theme_id}...")

    # Demander des suggestions à Claude
    suggestions = search_sources_for_theme(theme_id, num_sources)

    created_suggestions = []

    for suggestion in suggestions:
        print(f"  Validation de {suggestion['name']}...")

        # Valider la source
        validation = validate_source(suggestion["url"])

        if not validation["valid"]:
            print(f"    → Source invalide: {validation['error']}")
            continue

        # Utiliser le feed_url découvert si disponible
        feed_url = validation["feed_url"] or suggestion.get("feed_url")

        # Créer la suggestion en base
        created = create_suggested_source(
            theme_id=theme_id,
            name=suggestion["name"],
            url=suggestion["url"],
            feed_url=feed_url,
            description=suggestion.get("description"),
            reason=suggestion.get("reason"),
        )

        if created:
            created_suggestions.append(
                {
                    "id": created.id,
                    "name": created.name,
                    "url": created.url,
                    "feed_url": created.feed_url,
                    "description": created.description,
                    "reason": created.reason,
                }
            )
            print(f"    → Ajoutée comme suggestion (RSS: {'Oui' if feed_url else 'Non'})")

    return created_suggestions


def search_sources_by_query(query: str, num_sources: int = 5) -> list[dict]:
    """
    Recherche des sources basée sur une requête libre.

    Utile quand l'utilisateur veut chercher sans avoir créé de thème.
    """
    client = get_client()

    prompt = f"""Tu es un expert en veille technologique. Je cherche des sources d'information sur : "{query}"

Suggère {num_sources} sources de qualité (blogs, sites d'actualité, newsletters) avec flux RSS de préférence.

Pour chaque source, fournis :
- name: Nom de la source
- url: URL du site principal
- feed_url: URL du flux RSS si connu (sinon null)
- description: Brève description (1 phrase)
- reason: Pourquoi cette source est pertinente pour "{query}"

Réponds UNIQUEMENT en JSON valide avec cette structure :
{{
    "sources": [
        {{
            "name": "...",
            "url": "...",
            "feed_url": "..." ou null,
            "description": "...",
            "reason": "..."
        }}
    ]
}}

Privilégie :
- Les sources avec contenu récent et régulier
- Les sites reconnus dans le domaine
- Les sources en français ET anglais
- Les blogs techniques d'experts"""

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = response.content[0].text

    if "```json" in response_text:
        response_text = response_text.split("```json")[1].split("```")[0]
    elif "```" in response_text:
        response_text = response_text.split("```")[1].split("```")[0]

    try:
        result = json.loads(response_text.strip())
        sources = result.get("sources", [])

        # Valider chaque source
        validated_sources = []
        for source in sources:
            validation = validate_source(source["url"])
            if validation["valid"]:
                source["feed_url"] = validation["feed_url"] or source.get("feed_url")
                source["validated"] = True
                validated_sources.append(source)

        return validated_sources

    except json.JSONDecodeError as e:
        print(f"Erreur de parsing JSON: {e}")
        return []
