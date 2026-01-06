/**
 * Veille - Application JavaScript
 * Gère l'interface utilisateur du site statique
 */

// État global
const state = {
    themes: [],
    articles: [],
    favorites: [],
    suggestions: [],
    metadata: null,
    currentTheme: null,
    ratings: JSON.parse(localStorage.getItem('veille_ratings') || '{}'),
    localFavorites: JSON.parse(localStorage.getItem('veille_favorites') || '[]'),
};

// Éléments DOM
const elements = {
    articlesContainer: document.getElementById('articles-container'),
    themesContainer: document.getElementById('themes-container'),
    favoritesContainer: document.getElementById('favorites-container'),
    suggestionsContainer: document.getElementById('suggestions-container'),
    statsContainer: document.getElementById('stats-container'),
    filterTheme: document.getElementById('filter-theme'),
    sortBy: document.getElementById('sort-by'),
    lastUpdate: document.getElementById('last-update'),
    modal: document.getElementById('article-modal'),
    modalBody: document.getElementById('modal-body'),
    toastContainer: document.getElementById('toast-container'),
};

// ============ Chargement des données ============

async function loadData(filename) {
    try {
        const response = await fetch(`data/${filename}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`Erreur chargement ${filename}:`, error);
        return null;
    }
}

async function initApp() {
    showLoading(elements.articlesContainer);

    // Charger les données en parallèle
    const [themes, recent, favorites, suggestions, metadata] = await Promise.all([
        loadData('themes.json'),
        loadData('recent.json'),
        loadData('favorites.json'),
        loadData('suggestions.json'),
        loadData('metadata.json'),
    ]);

    state.themes = themes || [];
    state.articles = recent || [];
    state.favorites = favorites || [];
    state.suggestions = suggestions || [];
    state.metadata = metadata;

    // Appliquer les ratings locaux
    applyLocalRatings();

    // Mettre à jour l'interface
    populateThemeFilter();
    renderArticles();
    updateLastUpdate();

    // Configurer les événements
    setupEventListeners();
}

function applyLocalRatings() {
    // Appliquer les ratings stockés localement
    state.articles.forEach(article => {
        if (state.ratings[article.id]) {
            article.user_rating = state.ratings[article.id];
        }
        if (state.localFavorites.includes(article.id)) {
            article.is_favorite = true;
        }
    });
}

// ============ Rendu des articles ============

function renderArticles(articles = null) {
    const container = elements.articlesContainer;
    const data = articles || getFilteredArticles();

    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Aucun article</h3>
                <p>Exécutez "veille run" pour récupérer des articles.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = data.map(article => createArticleCard(article)).join('');
}

function createArticleCard(article) {
    const scoreClass = getScoreClass(article.relevance_score);
    const tags = article.tags?.slice(0, 4) || [];
    const rating = state.ratings[article.id] || article.user_rating;
    const isFavorite = state.localFavorites.includes(article.id) || article.is_favorite;

    return `
        <article class="article-card" data-id="${article.id}">
            <div class="article-header">
                <div class="article-meta">
                    <span class="article-source">${escapeHtml(article.source_name)}</span>
                    <span class="article-date">${article.published_display}</span>
                </div>
                ${article.relevance_score !== null ? `
                    <span class="article-score ${scoreClass}">${article.relevance_display}</span>
                ` : ''}
            </div>

            <h3 class="article-title">
                <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener">
                    ${escapeHtml(article.title)}
                </a>
            </h3>

            <p class="article-summary">${escapeHtml(article.summary)}</p>

            ${tags.length > 0 ? `
                <div class="article-tags">
                    ${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
            ` : ''}

            <div class="article-actions">
                <div class="rating-buttons">
                    <button class="rating-btn up ${rating === 1 ? 'active' : ''}"
                            onclick="rateArticle(${article.id}, 1)" title="Intéressant">
                        👍
                    </button>
                    <button class="rating-btn down ${rating === -1 ? 'active' : ''}"
                            onclick="rateArticle(${article.id}, -1)" title="Pas intéressant">
                        👎
                    </button>
                    <button class="rating-btn favorite ${isFavorite ? 'active' : ''}"
                            onclick="toggleFavorite(${article.id})" title="Favori">
                        ⭐
                    </button>
                </div>
                <button class="btn btn-sm btn-secondary" onclick="showArticleDetails(${article.id})">
                    Détails
                </button>
            </div>
        </article>
    `;
}

function getScoreClass(score) {
    if (score === null || score === undefined) return '';
    if (score >= 0.7) return 'high';
    if (score >= 0.4) return 'medium';
    return 'low';
}

function getFilteredArticles() {
    let articles = [...state.articles];

    // Filtrer par thème
    const themeId = elements.filterTheme.value;
    if (themeId) {
        articles = articles.filter(a => a.theme_id === parseInt(themeId));
    }

    // Trier
    const sortBy = elements.sortBy.value;
    if (sortBy === 'relevance') {
        articles.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
    } else if (sortBy === 'date') {
        articles.sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
    }

    return articles;
}

// ============ Rendu des thèmes ============

async function renderThemes() {
    const container = elements.themesContainer;

    if (!state.themes || state.themes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Aucun thème</h3>
                <p>Créez un thème avec "veille theme add".</p>
            </div>
        `;
        return;
    }

    // Charger les stats par thème
    const themesWithStats = await Promise.all(state.themes.map(async theme => {
        const articles = await loadData(`theme_${theme.id}.json`) || [];
        return { ...theme, articleCount: articles.length };
    }));

    container.innerHTML = themesWithStats.map(theme => `
        <div class="theme-card" onclick="filterByTheme(${theme.id})">
            <h3 class="theme-name">${escapeHtml(theme.name)}</h3>
            ${theme.description ? `<p class="theme-description">${escapeHtml(theme.description)}</p>` : ''}
            ${theme.keywords?.length > 0 ? `
                <div class="theme-keywords">
                    ${theme.keywords.slice(0, 5).map(kw => `<span class="tag">${escapeHtml(kw)}</span>`).join('')}
                </div>
            ` : ''}
            <div class="theme-stats">
                <span>${theme.articleCount} articles</span>
            </div>
        </div>
    `).join('');
}

// ============ Rendu des favoris ============

function renderFavorites() {
    const container = elements.favoritesContainer;

    // Combiner favoris du serveur et locaux
    const favoriteIds = new Set(state.localFavorites);
    const allFavorites = [
        ...state.favorites,
        ...state.articles.filter(a => favoriteIds.has(a.id) && !state.favorites.find(f => f.id === a.id))
    ];

    if (allFavorites.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Aucun favori</h3>
                <p>Cliquez sur ⭐ pour ajouter des articles en favoris.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = allFavorites.map(article => createArticleCard(article)).join('');
}

// ============ Rendu des suggestions ============

function renderSuggestions() {
    const container = elements.suggestionsContainer;

    if (!state.suggestions || state.suggestions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Aucune suggestion</h3>
                <p>Utilisez "veille source search [thème]" pour découvrir des sources.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.suggestions.map(suggestion => `
        <div class="suggestion-card" data-id="${suggestion.id}">
            <div class="suggestion-info">
                <h3 class="suggestion-name">${escapeHtml(suggestion.name)}</h3>
                <a class="suggestion-url" href="${escapeHtml(suggestion.url)}" target="_blank" rel="noopener">
                    ${escapeHtml(suggestion.url)}
                </a>
                ${suggestion.reason ? `<p class="suggestion-reason">${escapeHtml(suggestion.reason)}</p>` : ''}
                <div class="suggestion-meta">
                    <span>Thème: ${escapeHtml(suggestion.theme_name)}</span>
                    <span>RSS: ${suggestion.feed_url ? 'Oui' : 'Non'}</span>
                </div>
            </div>
            <div class="suggestion-actions">
                <button class="btn btn-sm btn-primary" onclick="markSuggestion(${suggestion.id}, 'accept')">
                    Accepter
                </button>
                <button class="btn btn-sm btn-secondary" onclick="markSuggestion(${suggestion.id}, 'reject')">
                    Rejeter
                </button>
            </div>
        </div>
    `).join('');
}

// ============ Rendu des paramètres ============

function renderStats() {
    const container = elements.statsContainer;

    const totalRatings = Object.keys(state.ratings).length;
    const positiveRatings = Object.values(state.ratings).filter(r => r === 1).length;
    const negativeRatings = Object.values(state.ratings).filter(r => r === -1).length;

    container.innerHTML = `
        <div class="stat-item">
            <div class="stat-value">${state.themes.length}</div>
            <div class="stat-label">Thèmes</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${state.articles.length}</div>
            <div class="stat-label">Articles récents</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${state.localFavorites.length}</div>
            <div class="stat-label">Favoris</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${positiveRatings} / ${negativeRatings}</div>
            <div class="stat-label">👍 / 👎</div>
        </div>
    `;
}

// ============ Actions utilisateur ============

function rateArticle(articleId, rating) {
    const currentRating = state.ratings[articleId];

    // Toggle si même note
    if (currentRating === rating) {
        delete state.ratings[articleId];
    } else {
        state.ratings[articleId] = rating;
    }

    // Sauvegarder localement
    localStorage.setItem('veille_ratings', JSON.stringify(state.ratings));

    // Mettre à jour l'article en mémoire
    const article = state.articles.find(a => a.id === articleId);
    if (article) {
        article.user_rating = state.ratings[articleId] || null;
    }

    // Re-rendre la carte
    const card = document.querySelector(`.article-card[data-id="${articleId}"]`);
    if (card) {
        const newCard = document.createElement('div');
        newCard.innerHTML = createArticleCard(article || { id: articleId });
        card.replaceWith(newCard.firstElementChild);
    }

    showToast('Note enregistrée', 'success');
}

function toggleFavorite(articleId) {
    const index = state.localFavorites.indexOf(articleId);

    if (index > -1) {
        state.localFavorites.splice(index, 1);
    } else {
        state.localFavorites.push(articleId);
    }

    localStorage.setItem('veille_favorites', JSON.stringify(state.localFavorites));

    // Mettre à jour l'article
    const article = state.articles.find(a => a.id === articleId);
    if (article) {
        article.is_favorite = state.localFavorites.includes(articleId);
    }

    // Re-rendre
    const card = document.querySelector(`.article-card[data-id="${articleId}"]`);
    if (card && article) {
        const newCard = document.createElement('div');
        newCard.innerHTML = createArticleCard(article);
        card.replaceWith(newCard.firstElementChild);
    }

    showToast(index > -1 ? 'Retiré des favoris' : 'Ajouté aux favoris', 'success');
}

function markSuggestion(suggestionId, action) {
    // Note: Cette action est locale seulement
    // L'utilisateur devra utiliser le CLI pour vraiment accepter/rejeter
    const card = document.querySelector(`.suggestion-card[data-id="${suggestionId}"]`);
    if (card) {
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
    }

    const localDecisions = JSON.parse(localStorage.getItem('veille_suggestions') || '{}');
    localDecisions[suggestionId] = action;
    localStorage.setItem('veille_suggestions', JSON.stringify(localDecisions));

    showToast(
        action === 'accept'
            ? 'Marqué pour acceptation (utilisez le CLI pour confirmer)'
            : 'Marqué pour rejet',
        'success'
    );
}

function showArticleDetails(articleId) {
    const article = state.articles.find(a => a.id === articleId)
        || state.favorites.find(a => a.id === articleId);

    if (!article) return;

    elements.modalBody.innerHTML = `
        <div class="article-detail">
            <div class="article-meta" style="margin-bottom: 1rem;">
                <span class="article-source">${escapeHtml(article.source_name)}</span>
                <span class="article-date">${article.published_display}</span>
                ${article.relevance_score !== null ? `
                    <span class="article-score ${getScoreClass(article.relevance_score)}">
                        ${article.relevance_display}
                    </span>
                ` : ''}
            </div>

            <h2 style="margin-bottom: 1rem;">${escapeHtml(article.title)}</h2>

            <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
                ${escapeHtml(article.summary)}
            </p>

            ${article.key_points?.length > 0 ? `
                <div class="key-points">
                    <h4>Points clés</h4>
                    <ul>
                        ${article.key_points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}

            ${article.tags?.length > 0 ? `
                <div class="article-tags" style="margin: 1.5rem 0;">
                    ${article.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
            ` : ''}

            <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener"
               class="btn btn-primary" style="margin-top: 1rem;">
                Lire l'article complet →
            </a>
        </div>
    `;

    elements.modal.classList.add('active');
}

function filterByTheme(themeId) {
    elements.filterTheme.value = themeId;
    renderArticles();
    switchPage('home');
}

// ============ Export ============

function exportFeedback() {
    const data = {
        exported_at: new Date().toISOString(),
        ratings: Object.entries(state.ratings).map(([id, rating]) => ({
            article_id: parseInt(id),
            rating: rating
        })),
        favorites: state.localFavorites,
        suggestion_decisions: JSON.parse(localStorage.getItem('veille_suggestions') || '{}'),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `veille_feedback_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showToast('Fichier exporté', 'success');
}

function clearLocalData() {
    if (confirm('Êtes-vous sûr de vouloir effacer toutes les données locales ?')) {
        localStorage.removeItem('veille_ratings');
        localStorage.removeItem('veille_favorites');
        localStorage.removeItem('veille_suggestions');
        state.ratings = {};
        state.localFavorites = [];
        renderArticles();
        renderFavorites();
        renderStats();
        showToast('Données locales effacées', 'success');
    }
}

// ============ Navigation ============

function switchPage(pageName) {
    // Mettre à jour les liens
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === pageName);
    });

    // Afficher la page
    document.querySelectorAll('.page').forEach(page => {
        page.classList.toggle('active', page.id === `page-${pageName}`);
    });

    // Charger le contenu si nécessaire
    switch (pageName) {
        case 'themes':
            renderThemes();
            break;
        case 'favorites':
            renderFavorites();
            break;
        case 'discover':
            renderSuggestions();
            break;
        case 'settings':
            renderStats();
            break;
    }
}

// ============ Utilitaires ============

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading(container) {
    container.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
        </div>
    `;
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function populateThemeFilter() {
    elements.filterTheme.innerHTML = '<option value="">Tous les thèmes</option>';
    state.themes.forEach(theme => {
        const option = document.createElement('option');
        option.value = theme.id;
        option.textContent = theme.name;
        elements.filterTheme.appendChild(option);
    });
}

function updateLastUpdate() {
    if (state.metadata?.generated_at) {
        const date = new Date(state.metadata.generated_at);
        elements.lastUpdate.textContent = date.toLocaleString('fr-FR');
    }
}

// ============ Event Listeners ============

function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchPage(link.dataset.page);
        });
    });

    // Filtres
    elements.filterTheme.addEventListener('change', () => renderArticles());
    elements.sortBy.addEventListener('change', () => renderArticles());

    // Modal
    elements.modal.querySelector('.modal-close').addEventListener('click', () => {
        elements.modal.classList.remove('active');
    });
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) {
            elements.modal.classList.remove('active');
        }
    });

    // Export/Clear
    document.getElementById('btn-export').addEventListener('click', exportFeedback);
    document.getElementById('btn-clear-local').addEventListener('click', clearLocalData);

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            elements.modal.classList.remove('active');
        }
    });
}

// ============ Initialisation ============

document.addEventListener('DOMContentLoaded', initApp);
