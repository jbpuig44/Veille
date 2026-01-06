"""Interface en ligne de commande pour Veille."""

import json
import sys

import click
from rich.console import Console
from rich.table import Table

from .database import (
    accept_suggestion,
    create_source,
    create_theme,
    delete_source,
    delete_theme,
    get_all_sources,
    get_all_themes,
    get_pending_suggestions,
    get_recent_articles,
    get_sources_by_theme,
    get_theme_by_name,
    initialize_database,
    rate_article,
    reject_suggestion,
    update_source,
    update_theme,
)

console = Console()


@click.group()
@click.version_option(version="0.1.0")
def main():
    """Veille - Agrégateur de news intelligent avec analyse IA."""
    initialize_database()


# ============ Commandes Thèmes ============


@main.group()
def theme():
    """Gestion des thèmes de veille."""
    pass


@theme.command("list")
def theme_list():
    """Liste tous les thèmes."""
    themes = get_all_themes(active_only=False)

    if not themes:
        console.print("[yellow]Aucun thème configuré.[/yellow]")
        console.print("Créez un thème avec: veille theme add <nom>")
        return

    table = Table(title="Thèmes de veille")
    table.add_column("ID", style="cyan")
    table.add_column("Nom", style="green")
    table.add_column("Mots-clés")
    table.add_column("Actif")

    for t in themes:
        keywords = ""
        if t.keywords:
            try:
                kw_list = json.loads(t.keywords)
                keywords = ", ".join(kw_list[:3])
                if len(kw_list) > 3:
                    keywords += "..."
            except json.JSONDecodeError:
                pass

        active = "[green]Oui[/green]" if t.is_active else "[red]Non[/red]"
        table.add_row(str(t.id), t.name, keywords, active)

    console.print(table)


@theme.command("add")
@click.argument("name")
@click.option("--description", "-d", default="", help="Description du thème")
@click.option("--keywords", "-k", default="", help="Mots-clés séparés par des virgules")
def theme_add(name: str, description: str, keywords: str):
    """Ajoute un nouveau thème."""
    kw_list = [k.strip() for k in keywords.split(",") if k.strip()] if keywords else []

    theme = create_theme(name=name, description=description, keywords=kw_list)
    console.print(f"[green]Thème '{theme.name}' créé avec l'ID {theme.id}[/green]")


@theme.command("edit")
@click.argument("theme_id", type=int)
@click.option("--name", "-n", help="Nouveau nom")
@click.option("--description", "-d", help="Nouvelle description")
@click.option("--keywords", "-k", help="Nouveaux mots-clés (virgules)")
@click.option("--active/--inactive", default=None, help="Activer/désactiver")
def theme_edit(theme_id: int, name: str, description: str, keywords: str, active: bool):
    """Modifie un thème existant."""
    updates = {}
    if name:
        updates["name"] = name
    if description is not None:
        updates["description"] = description
    if keywords is not None:
        updates["keywords"] = [k.strip() for k in keywords.split(",") if k.strip()]
    if active is not None:
        updates["is_active"] = active

    if not updates:
        console.print("[yellow]Aucune modification spécifiée.[/yellow]")
        return

    theme = update_theme(theme_id, **updates)
    if theme:
        console.print(f"[green]Thème {theme_id} mis à jour.[/green]")
    else:
        console.print(f"[red]Thème {theme_id} non trouvé.[/red]")


@theme.command("delete")
@click.argument("theme_id", type=int)
@click.confirmation_option(prompt="Êtes-vous sûr de vouloir supprimer ce thème ?")
def theme_delete(theme_id: int):
    """Supprime un thème."""
    if delete_theme(theme_id):
        console.print(f"[green]Thème {theme_id} supprimé.[/green]")
    else:
        console.print(f"[red]Thème {theme_id} non trouvé.[/red]")


# ============ Commandes Sources ============


@main.group()
def source():
    """Gestion des sources de news."""
    pass


@source.command("list")
@click.option("--theme", "-t", "theme_name", help="Filtrer par nom de thème")
def source_list(theme_name: str):
    """Liste toutes les sources."""
    if theme_name:
        theme = get_theme_by_name(theme_name)
        if not theme:
            console.print(f"[red]Thème '{theme_name}' non trouvé.[/red]")
            return
        sources = get_sources_by_theme(theme.id, active_only=False)
    else:
        sources = get_all_sources(active_only=False)

    if not sources:
        console.print("[yellow]Aucune source configurée.[/yellow]")
        return

    table = Table(title="Sources de news")
    table.add_column("ID", style="cyan")
    table.add_column("Nom", style="green")
    table.add_column("Thème")
    table.add_column("Type")
    table.add_column("Qualité")
    table.add_column("Actif")

    for s in sources:
        quality = f"{s.quality_score * 100:.0f}%"
        active = "[green]Oui[/green]" if s.is_active else "[red]Non[/red]"
        theme_name_display = s.theme.name if s.theme else "N/A"
        table.add_row(str(s.id), s.name, theme_name_display, s.source_type, quality, active)

    console.print(table)


@source.command("add")
@click.argument("url")
@click.option("--theme", "-t", "theme_name", required=True, help="Nom du thème")
@click.option("--name", "-n", help="Nom de la source (auto-détecté si omis)")
@click.option("--type", "-T", "source_type", default="rss", help="Type: rss, web")
def source_add(url: str, theme_name: str, name: str, source_type: str):
    """Ajoute une source manuellement."""
    theme = get_theme_by_name(theme_name)
    if not theme:
        console.print(f"[red]Thème '{theme_name}' non trouvé.[/red]")
        console.print("Thèmes disponibles:")
        for t in get_all_themes():
            console.print(f"  - {t.name}")
        return

    # Découvrir le flux RSS si possible
    console.print(f"Vérification de {url}...")

    from .fetcher import discover_feed_sync

    feed_url = discover_feed_sync(url)

    if feed_url:
        console.print(f"[green]Flux RSS trouvé: {feed_url}[/green]")
    else:
        console.print("[yellow]Pas de flux RSS trouvé, utilisation de l'URL directe.[/yellow]")

    # Utiliser l'URL comme nom si non spécifié
    if not name:
        from urllib.parse import urlparse

        name = urlparse(url).netloc

    source = create_source(
        theme_id=theme.id,
        name=name,
        url=url,
        feed_url=feed_url or url,
        source_type=source_type,
    )

    console.print(f"[green]Source '{source.name}' ajoutée avec l'ID {source.id}[/green]")


@source.command("search")
@click.argument("theme_name")
@click.option("--count", "-c", default=5, help="Nombre de sources à chercher")
def source_search(theme_name: str, count: int):
    """Recherche des sources via IA pour un thème."""
    theme = get_theme_by_name(theme_name)
    if not theme:
        console.print(f"[red]Thème '{theme_name}' non trouvé.[/red]")
        return

    console.print(f"[cyan]Recherche de sources pour '{theme_name}' via IA...[/cyan]")

    from .source_finder import suggest_sources_for_theme

    try:
        suggestions = suggest_sources_for_theme(theme.id, count)

        if not suggestions:
            console.print("[yellow]Aucune source trouvée.[/yellow]")
            return

        console.print(f"\n[green]{len(suggestions)} sources suggérées :[/green]\n")

        for s in suggestions:
            console.print(f"[bold]{s['name']}[/bold]")
            console.print(f"  URL: {s['url']}")
            console.print(f"  RSS: {s['feed_url'] or 'Non trouvé'}")
            console.print(f"  Raison: {s['reason']}")
            console.print()

        console.print("Utilisez 'veille suggest list' pour voir les suggestions en attente.")
        console.print("Utilisez 'veille suggest accept <id>' pour accepter une suggestion.")

    except Exception as e:
        console.print(f"[red]Erreur: {e}[/red]")


@source.command("delete")
@click.argument("source_id", type=int)
@click.confirmation_option(prompt="Êtes-vous sûr ?")
def source_delete(source_id: int):
    """Supprime une source."""
    if delete_source(source_id):
        console.print(f"[green]Source {source_id} supprimée.[/green]")
    else:
        console.print(f"[red]Source {source_id} non trouvée.[/red]")


@source.command("toggle")
@click.argument("source_id", type=int)
def source_toggle(source_id: int):
    """Active/désactive une source."""
    from .database import get_source

    source = get_source(source_id)
    if not source:
        console.print(f"[red]Source {source_id} non trouvée.[/red]")
        return

    new_state = not source.is_active
    update_source(source_id, is_active=new_state)

    state_text = "[green]activée[/green]" if new_state else "[red]désactivée[/red]"
    console.print(f"Source {source.name} {state_text}.")


# ============ Commandes Suggestions ============


@main.group()
def suggest():
    """Gestion des sources suggérées par l'IA."""
    pass


@suggest.command("list")
def suggest_list():
    """Liste les suggestions en attente."""
    suggestions = get_pending_suggestions()

    if not suggestions:
        console.print("[yellow]Aucune suggestion en attente.[/yellow]")
        return

    table = Table(title="Sources suggérées")
    table.add_column("ID", style="cyan")
    table.add_column("Nom", style="green")
    table.add_column("Thème")
    table.add_column("RSS")
    table.add_column("Raison")

    for s in suggestions:
        rss = "[green]Oui[/green]" if s.feed_url else "[yellow]Non[/yellow]"
        reason = (s.reason[:40] + "...") if s.reason and len(s.reason) > 40 else (s.reason or "")
        table.add_row(str(s.id), s.name, s.theme.name, rss, reason)

    console.print(table)


@suggest.command("accept")
@click.argument("suggestion_id", type=int)
def suggest_accept(suggestion_id: int):
    """Accepte une suggestion et crée la source."""
    source = accept_suggestion(suggestion_id)
    if source:
        console.print(f"[green]Source '{source.name}' créée avec l'ID {source.id}[/green]")
    else:
        console.print(f"[red]Suggestion {suggestion_id} non trouvée ou déjà traitée.[/red]")


@suggest.command("reject")
@click.argument("suggestion_id", type=int)
def suggest_reject(suggestion_id: int):
    """Rejette une suggestion."""
    if reject_suggestion(suggestion_id):
        console.print(f"[green]Suggestion {suggestion_id} rejetée.[/green]")
    else:
        console.print(f"[red]Suggestion {suggestion_id} non trouvée ou déjà traitée.[/red]")


@suggest.command("accept-all")
@click.confirmation_option(prompt="Accepter toutes les suggestions ?")
def suggest_accept_all():
    """Accepte toutes les suggestions en attente."""
    suggestions = get_pending_suggestions()
    count = 0
    for s in suggestions:
        if accept_suggestion(s.id):
            count += 1
    console.print(f"[green]{count} sources créées.[/green]")


# ============ Commandes Fetch/Analyze ============


@main.command()
@click.option("--theme", "-t", "theme_name", help="Filtrer par thème")
def fetch(theme_name: str):
    """Récupère les articles depuis les sources."""
    from .fetcher import fetch_sources_sync

    console.print("[cyan]Récupération des articles...[/cyan]")

    source_ids = None
    if theme_name:
        theme = get_theme_by_name(theme_name)
        if not theme:
            console.print(f"[red]Thème '{theme_name}' non trouvé.[/red]")
            return
        sources = get_sources_by_theme(theme.id)
        source_ids = [s.id for s in sources]

    results = fetch_sources_sync(source_ids)

    total = sum(results.values())
    console.print(f"\n[green]{total} nouveaux articles récupérés.[/green]")


@main.command()
@click.option("--limit", "-l", default=50, help="Nombre max d'articles à analyser")
def analyze(limit: int):
    """Analyse les articles avec Claude."""
    from .analyzer import analyze_all_pending

    console.print("[cyan]Analyse des articles avec Claude...[/cyan]")

    try:
        count = analyze_all_pending(limit=limit)
        console.print(f"\n[green]{count} articles analysés.[/green]")
    except Exception as e:
        console.print(f"[red]Erreur: {e}[/red]")
        sys.exit(1)


@main.command()
def build():
    """Génère le site statique."""
    from .builder import build_site

    console.print("[cyan]Génération du site...[/cyan]")
    build_site()
    console.print("[green]Site généré avec succès ![/green]")


@main.command()
@click.option("--skip-fetch", is_flag=True, help="Ne pas récupérer les articles")
@click.option("--skip-analyze", is_flag=True, help="Ne pas analyser les articles")
def run(skip_fetch: bool, skip_analyze: bool):
    """Exécute le pipeline complet: fetch → analyze → build."""
    from .analyzer import analyze_all_pending
    from .builder import build_site
    from .fetcher import fetch_sources_sync

    if not skip_fetch:
        console.print("\n[bold cyan]1. Récupération des articles...[/bold cyan]")
        results = fetch_sources_sync()
        total = sum(results.values())
        console.print(f"   → {total} nouveaux articles")

    if not skip_analyze:
        console.print("\n[bold cyan]2. Analyse avec Claude...[/bold cyan]")
        try:
            count = analyze_all_pending()
            console.print(f"   → {count} articles analysés")
        except Exception as e:
            console.print(f"   → [red]Erreur: {e}[/red]")

    console.print("\n[bold cyan]3. Génération du site...[/bold cyan]")
    build_site()
    console.print("   → Site généré")

    console.print("\n[bold green]Pipeline terminé ![/bold green]")


# ============ Commandes Articles ============


@main.group()
def article():
    """Gestion des articles."""
    pass


@article.command("list")
@click.option("--theme", "-t", "theme_name", help="Filtrer par thème")
@click.option("--limit", "-l", default=20, help="Nombre d'articles")
def article_list(theme_name: str, limit: int):
    """Liste les articles récents."""
    articles = get_recent_articles(days=7, limit=limit)

    if theme_name:
        theme = get_theme_by_name(theme_name)
        if theme:
            articles = [a for a in articles if a.source.theme_id == theme.id]

    if not articles:
        console.print("[yellow]Aucun article récent.[/yellow]")
        return

    table = Table(title="Articles récents")
    table.add_column("ID", style="cyan")
    table.add_column("Titre", max_width=50)
    table.add_column("Source")
    table.add_column("Score")
    table.add_column("Note")

    for a in articles:
        score = f"{a.relevance_score * 100:.0f}%" if a.relevance_score else "N/A"
        rating = ""
        if a.user_rating == 1:
            rating = "[green]👍[/green]"
        elif a.user_rating == -1:
            rating = "[red]👎[/red]"
        elif a.is_favorite:
            rating = "[yellow]⭐[/yellow]"

        table.add_row(str(a.id), a.title[:50], a.source.name, score, rating)

    console.print(table)


@article.command("rate")
@click.argument("article_id", type=int)
@click.argument("rating", type=click.Choice(["up", "down", "neutral"]))
def article_rate(article_id: int, rating: str):
    """Note un article (up/down/neutral)."""
    rating_value = {"up": 1, "down": -1, "neutral": 0}[rating]
    article = rate_article(article_id, rating_value)

    if article:
        console.print(f"[green]Article {article_id} noté.[/green]")
    else:
        console.print(f"[red]Article {article_id} non trouvé.[/red]")


@article.command("digest")
@click.option("--theme", "-t", "theme_name", help="Thème spécifique")
def article_digest(theme_name: str):
    """Génère un digest quotidien."""
    from .analyzer import generate_daily_digest

    theme_id = None
    if theme_name:
        theme = get_theme_by_name(theme_name)
        if not theme:
            console.print(f"[red]Thème '{theme_name}' non trouvé.[/red]")
            return
        theme_id = theme.id

    console.print("[cyan]Génération du digest...[/cyan]\n")

    try:
        digest = generate_daily_digest(theme_id)
        console.print(digest)
    except Exception as e:
        console.print(f"[red]Erreur: {e}[/red]")


# ============ Import/Export ============


@main.command("import-feedback")
@click.argument("filepath", type=click.Path(exists=True))
def import_feedback(filepath: str):
    """Importe les feedbacks depuis un fichier JSON."""
    from .database import get_article, update_article

    with open(filepath, encoding="utf-8") as f:
        data = json.load(f)

    count = 0
    for item in data.get("ratings", []):
        article_id = item.get("article_id")
        if article_id:
            article = get_article(article_id)
            if article:
                update_article(
                    article_id,
                    user_rating=item.get("rating"),
                    is_favorite=item.get("is_favorite", False),
                )
                count += 1

    console.print(f"[green]{count} feedbacks importés.[/green]")


@main.command("export-data")
@click.argument("filepath", type=click.Path())
def export_data(filepath: str):
    """Exporte les données complètes."""
    from .database import get_all_themes, get_all_sources

    data = {
        "themes": [
            {"id": t.id, "name": t.name, "keywords": json.loads(t.keywords or "[]")}
            for t in get_all_themes(active_only=False)
        ],
        "sources": [
            {"id": s.id, "name": s.name, "url": s.url, "theme_id": s.theme_id}
            for s in get_all_sources(active_only=False)
        ],
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    console.print(f"[green]Données exportées vers {filepath}[/green]")


if __name__ == "__main__":
    main()
