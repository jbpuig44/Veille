/**
 * Veille - Application JavaScript
 * Interface pour l'agrégateur de news avec API Cloudflare Workers
 */

// Configuration API
const API_BASE = '/api';

// État global
const state = {
    themes: [],
    articles: [],
    sources: [],
    suggestions: [],
    stats: null,
};

// ============ API Calls ============

async function api(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const config = {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    };

    if (options.body && typeof options.body === 'object') {
        config.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

// ============ Initialization ============

async function initApp() {
    showLoading(document.getElementById('articles-container'));

    try {
        // Load initial data
        const [themes, articles, stats] = await Promise.all([
            api('/themes'),
            api('/articles?limit=50'),
            api('/stats'),
        ]);

        state.themes = themes || [];
        state.articles = articles || [];
        state.stats = stats;

        // Update UI
        populateThemeFilters();
        renderArticles();
        updateLastUpdate();

    } catch (error) {
        console.error('Init error:', error);
        showToast('Erreur de chargement des données', 'error');
    }

    setupEventListeners();
}

// ============ Articles ============

function renderArticles(articles = null) {
    const container = document.getElementById('articles-container');
    const data = articles || getFilteredArticles();

    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Aucun article</h3>
                <p>Cliquez sur "Actualiser" pour récupérer des articles.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = data.map(article => createArticleCard(article)).join('');
}

function createArticleCard(article) {
    const scoreClass = getScoreClass(article.relevance_score);
    const tags = (article.tags || []).slice(0, 4);

    return `
        <article class="article-card" data-id="${article.id}">
            <div class="article-header">
                <div class="article-meta">
                    <span class="article-source">${escapeHtml(article.source_name || 'Inconnu')}</span>
                    <span class="article-date">${formatDate(article.published_at)}</span>
                </div>
                ${article.relevance_score !== null ? `
                    <span class="article-score ${scoreClass}">${Math.round((article.relevance_score || 0) * 100)}%</span>
                ` : ''}
            </div>

            <h3 class="article-title">
                <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener">
                    ${escapeHtml(article.title)}
                </a>
            </h3>

            <p class="article-summary">${escapeHtml(article.summary || 'Non analysé')}</p>

            ${tags.length > 0 ? `
                <div class="article-tags">
                    ${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
            ` : ''}

            <div class="article-actions">
                <div class="rating-buttons">
                    <button class="rating-btn up ${article.user_rating === 1 ? 'active' : ''}"
                            onclick="rateArticle(${article.id}, 1)" title="Intéressant">
                        👍
                    </button>
                    <button class="rating-btn down ${article.user_rating === -1 ? 'active' : ''}"
                            onclick="rateArticle(${article.id}, -1)" title="Pas intéressant">
                        👎
                    </button>
                    <button class="rating-btn favorite ${article.is_favorite ? 'active' : ''}"
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

function getFilteredArticles() {
    let articles = [...state.articles];

    const themeId = document.getElementById('filter-theme')?.value;
    if (themeId) {
        articles = articles.filter(a => a.theme_id === parseInt(themeId));
    }

    const sortBy = document.getElementById('sort-by')?.value;
    if (sortBy === 'date') {
        articles.sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
    } else {
        articles.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
    }

    return articles;
}

async function rateArticle(articleId, rating) {
    try {
        const article = state.articles.find(a => a.id === articleId);
        const newRating = article?.user_rating === rating ? 0 : rating;

        await api(`/articles/${articleId}/rate`, {
            method: 'POST',
            body: { rating: newRating },
        });

        if (article) {
            article.user_rating = newRating;
        }

        renderArticles();
        showToast('Note enregistrée', 'success');
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
    }
}

async function toggleFavorite(articleId) {
    try {
        const result = await api(`/articles/${articleId}/favorite`, { method: 'POST' });

        const article = state.articles.find(a => a.id === articleId);
        if (article) {
            article.is_favorite = result.is_favorite ? 1 : 0;
        }

        renderArticles();
        showToast(result.is_favorite ? 'Ajouté aux favoris' : 'Retiré des favoris', 'success');
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
    }
}

function showArticleDetails(articleId) {
    const article = state.articles.find(a => a.id === articleId);
    if (!article) return;

    const keyPoints = article.key_points || [];
    const tags = article.tags || [];

    document.getElementById('modal-body').innerHTML = `
        <div class="article-detail">
            <div class="article-meta" style="margin-bottom: 1rem;">
                <span class="article-source">${escapeHtml(article.source_name)}</span>
                <span class="article-date">${formatDate(article.published_at)}</span>
                ${article.relevance_score !== null ? `
                    <span class="article-score ${getScoreClass(article.relevance_score)}">
                        ${Math.round((article.relevance_score || 0) * 100)}%
                    </span>
                ` : ''}
            </div>

            <h2 style="margin-bottom: 1rem;">${escapeHtml(article.title)}</h2>

            <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
                ${escapeHtml(article.summary || 'Non analysé')}
            </p>

            ${keyPoints.length > 0 ? `
                <div class="key-points">
                    <h4>Points clés</h4>
                    <ul>
                        ${keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}

            ${tags.length > 0 ? `
                <div class="article-tags" style="margin: 1.5rem 0;">
                    ${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
            ` : ''}

            <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener"
               class="btn btn-primary" style="margin-top: 1rem;">
                Lire l'article complet →
            </a>
        </div>
    `;

    document.getElementById('article-modal').classList.add('active');
}

// ============ Themes ============

async function renderThemes() {
    const container = document.getElementById('themes-container');

    try {
        const themes = await api('/themes');
        state.themes = themes;

        if (!themes || themes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>Aucun thème</h3>
                    <p>Créez un thème dans l'onglet Admin.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = themes.map(theme => {
            const keywords = theme.keywords ? JSON.parse(theme.keywords) : [];
            return `
                <div class="theme-card" onclick="filterByTheme(${theme.id})">
                    <h3 class="theme-name">${escapeHtml(theme.name)}</h3>
                    ${theme.description ? `<p class="theme-description">${escapeHtml(theme.description)}</p>` : ''}
                    ${keywords.length > 0 ? `
                        <div class="theme-keywords">
                            ${keywords.slice(0, 5).map(kw => `<span class="tag">${escapeHtml(kw)}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

    } catch (error) {
        container.innerHTML = `<div class="empty-state"><p>Erreur: ${error.message}</p></div>`;
    }
}

function filterByTheme(themeId) {
    document.getElementById('filter-theme').value = themeId;
    renderArticles();
    switchPage('home');
}

// ============ Favorites ============

async function renderFavorites() {
    const container = document.getElementById('favorites-container');

    const favorites = state.articles.filter(a => a.is_favorite);

    if (favorites.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Aucun favori</h3>
                <p>Cliquez sur ⭐ pour ajouter des articles en favoris.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = favorites.map(article => createArticleCard(article)).join('');
}

// ============ Suggestions ============

async function renderSuggestions() {
    const container = document.getElementById('suggestions-container');

    try {
        const suggestions = await api('/suggestions');
        state.suggestions = suggestions;

        if (!suggestions || suggestions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>Aucune suggestion</h3>
                    <p>Utilisez la recherche IA dans l'onglet Admin pour découvrir des sources.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = suggestions.map(s => `
            <div class="suggestion-card" data-id="${s.id}">
                <div class="suggestion-info">
                    <h3 class="suggestion-name">${escapeHtml(s.name)}</h3>
                    <a class="suggestion-url" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
                        ${escapeHtml(s.url)}
                    </a>
                    ${s.reason ? `<p class="suggestion-reason">${escapeHtml(s.reason)}</p>` : ''}
                    <div class="suggestion-meta">
                        <span>Thème: ${escapeHtml(s.theme_name)}</span>
                        <span>RSS: ${s.feed_url ? 'Oui' : 'Non'}</span>
                    </div>
                </div>
                <div class="suggestion-actions">
                    <button class="btn btn-sm btn-primary" onclick="acceptSuggestion(${s.id})">
                        Accepter
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="rejectSuggestion(${s.id})">
                        Rejeter
                    </button>
                </div>
            </div>
        `).join('');

    } catch (error) {
        container.innerHTML = `<div class="empty-state"><p>Erreur: ${error.message}</p></div>`;
    }
}

async function acceptSuggestion(id) {
    try {
        await api(`/suggestions/${id}/accept`, { method: 'POST' });
        showToast('Source ajoutée', 'success');
        renderSuggestions();
        loadAdminSources();
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
    }
}

async function rejectSuggestion(id) {
    try {
        await api(`/suggestions/${id}/reject`, { method: 'POST' });
        showToast('Suggestion rejetée', 'success');
        renderSuggestions();
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
    }
}

// ============ Admin ============

async function renderAdmin() {
    await Promise.all([
        loadAdminStats(),
        loadAdminThemes(),
        loadAdminSources(),
    ]);
}

async function loadAdminStats() {
    const container = document.getElementById('admin-stats');

    try {
        const stats = await api('/stats');
        state.stats = stats;

        container.innerHTML = `
            <div class="stat-box">
                <div class="value">${stats.themes}</div>
                <div class="label">Thèmes</div>
            </div>
            <div class="stat-box">
                <div class="value">${stats.sources}</div>
                <div class="label">Sources</div>
            </div>
            <div class="stat-box">
                <div class="value">${stats.articles}</div>
                <div class="label">Articles</div>
            </div>
            <div class="stat-box">
                <div class="value">${stats.analyzed}</div>
                <div class="label">Analysés</div>
            </div>
        `;

        updateLastUpdate();
    } catch (error) {
        container.innerHTML = `<p>Erreur: ${error.message}</p>`;
    }
}

async function loadAdminThemes() {
    const container = document.getElementById('admin-themes-list');

    try {
        const themes = await api('/themes');
        state.themes = themes;

        if (themes.length === 0) {
            container.innerHTML = '<p class="empty-state">Aucun thème</p>';
            return;
        }

        container.innerHTML = themes.map(theme => {
            const keywords = theme.keywords ? JSON.parse(theme.keywords) : [];
            return `
                <div class="admin-list-item">
                    <div class="info">
                        <div class="name">${escapeHtml(theme.name)}</div>
                        <div class="meta">${keywords.slice(0, 3).join(', ')}${keywords.length > 3 ? '...' : ''}</div>
                    </div>
                    <div class="actions">
                        <button class="btn-icon-sm danger" onclick="deleteTheme(${theme.id})" title="Supprimer">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Update select dropdowns
        populateThemeFilters();
    } catch (error) {
        container.innerHTML = `<p>Erreur: ${error.message}</p>`;
    }
}

async function loadAdminSources() {
    const container = document.getElementById('admin-sources-list');

    try {
        const sources = await api('/sources');
        state.sources = sources;

        if (sources.length === 0) {
            container.innerHTML = '<p class="empty-state">Aucune source</p>';
            return;
        }

        container.innerHTML = sources.map(source => `
            <div class="admin-list-item">
                <div class="info">
                    <div class="name">
                        ${escapeHtml(source.name)}
                        <span class="status-badge ${source.is_active ? 'active' : 'inactive'}">
                            ${source.is_active ? 'Actif' : 'Inactif'}
                        </span>
                    </div>
                    <div class="meta">${escapeHtml(source.theme_name)} · ${Math.round(source.quality_score * 100)}% qualité</div>
                </div>
                <div class="actions">
                    <button class="btn-icon-sm ${source.is_active ? '' : 'success'}"
                            onclick="toggleSource(${source.id})"
                            title="${source.is_active ? 'Désactiver' : 'Activer'}">
                        ${source.is_active ? '⏸️' : '▶️'}
                    </button>
                    <button class="btn-icon-sm danger" onclick="deleteSource(${source.id})" title="Supprimer">
                        🗑️
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<p>Erreur: ${error.message}</p>`;
    }
}

async function addTheme(event) {
    event.preventDefault();

    const name = document.getElementById('input-theme-name').value.trim();
    const keywordsStr = document.getElementById('input-theme-keywords').value.trim();
    const keywords = keywordsStr ? keywordsStr.split(',').map(k => k.trim()).filter(k => k) : [];

    try {
        await api('/themes', {
            method: 'POST',
            body: { name, keywords },
        });

        document.getElementById('form-add-theme').reset();
        showToast('Thème créé', 'success');
        loadAdminThemes();
        loadAdminStats();
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
    }
}

async function deleteTheme(id) {
    if (!confirm('Supprimer ce thème et toutes ses sources ?')) return;

    try {
        await api(`/themes/${id}`, { method: 'DELETE' });
        showToast('Thème supprimé', 'success');
        loadAdminThemes();
        loadAdminSources();
        loadAdminStats();
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
    }
}

async function addSource(event) {
    event.preventDefault();

    const theme_id = parseInt(document.getElementById('input-source-theme').value);
    const name = document.getElementById('input-source-name').value.trim();
    const url = document.getElementById('input-source-url').value.trim();

    try {
        await api('/sources', {
            method: 'POST',
            body: { theme_id, name, url },
        });

        document.getElementById('form-add-source').reset();
        showToast('Source ajoutée', 'success');
        loadAdminSources();
        loadAdminStats();
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
    }
}

async function toggleSource(id) {
    try {
        await api(`/sources/${id}/toggle`, { method: 'POST' });
        loadAdminSources();
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
    }
}

async function deleteSource(id) {
    if (!confirm('Supprimer cette source ?')) return;

    try {
        await api(`/sources/${id}`, { method: 'DELETE' });
        showToast('Source supprimée', 'success');
        loadAdminSources();
        loadAdminStats();
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
    }
}

async function searchSources(event) {
    event.preventDefault();

    const theme_id = parseInt(document.getElementById('input-search-theme').value);
    const statusEl = document.getElementById('action-status');

    setActionStatus('Recherche de sources en cours...', 'loading');

    try {
        const result = await api('/search-sources', {
            method: 'POST',
            body: { theme_id, count: 5 },
        });

        setActionStatus(`${result.suggestions_count} sources trouvées !`, 'success');
        showToast(`${result.suggestions_count} sources suggérées`, 'success');
        renderSuggestions();
    } catch (error) {
        setActionStatus('Erreur: ' + error.message, 'error');
    }
}

async function fetchAllArticles() {
    setActionStatus('Récupération des articles...', 'loading');

    try {
        const result = await api('/fetch', { method: 'POST' });
        setActionStatus(`${result.articles_added} nouveaux articles récupérés`, 'success');

        // Reload articles
        const articles = await api('/articles?limit=50');
        state.articles = articles;
        renderArticles();
        loadAdminStats();
    } catch (error) {
        setActionStatus('Erreur: ' + error.message, 'error');
    }
}

async function analyzeAllArticles() {
    setActionStatus('Analyse IA en cours (peut prendre du temps)...', 'loading');

    try {
        const result = await api('/analyze', { method: 'POST' });
        setActionStatus(`${result.analyzed_count} articles analysés`, 'success');

        // Reload articles
        const articles = await api('/articles?limit=50');
        state.articles = articles;
        renderArticles();
        loadAdminStats();
    } catch (error) {
        setActionStatus('Erreur: ' + error.message, 'error');
    }
}

async function refreshArticles() {
    showLoading(document.getElementById('articles-container'));

    try {
        // Fetch + analyze
        await api('/fetch', { method: 'POST' });
        await api('/analyze', { method: 'POST' });

        // Reload
        const articles = await api('/articles?limit=50');
        state.articles = articles;
        renderArticles();

        showToast('Articles mis à jour', 'success');
    } catch (error) {
        showToast('Erreur: ' + error.message, 'error');
        renderArticles();
    }
}

function setActionStatus(message, type) {
    const el = document.getElementById('action-status');
    el.textContent = message;
    el.className = `action-status show ${type}`;
}

// ============ Navigation ============

function switchPage(pageName) {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === pageName);
    });

    document.querySelectorAll('.page').forEach(page => {
        page.classList.toggle('active', page.id === `page-${pageName}`);
    });

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
        case 'admin':
            renderAdmin();
            break;
    }
}

// ============ Utilities ============

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return 'Date inconnue';
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getScoreClass(score) {
    if (score === null || score === undefined) return '';
    if (score >= 0.7) return 'high';
    if (score >= 0.4) return 'medium';
    return 'low';
}

function showLoading(container) {
    container.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
        </div>
    `;
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function populateThemeFilters() {
    const selects = [
        document.getElementById('filter-theme'),
        document.getElementById('input-source-theme'),
        document.getElementById('input-search-theme'),
    ];

    selects.forEach(select => {
        if (!select) return;
        const currentValue = select.value;

        // Keep first option
        const firstOption = select.options[0];
        select.innerHTML = '';
        select.appendChild(firstOption);

        // Add themes
        state.themes.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            select.appendChild(option);
        });

        // Restore value if exists
        if (currentValue) {
            select.value = currentValue;
        }
    });
}

function updateLastUpdate() {
    const el = document.getElementById('last-update');
    if (state.stats?.generated_at) {
        el.textContent = formatDate(state.stats.generated_at);
    } else {
        el.textContent = formatDate(new Date().toISOString());
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

    // Filters
    document.getElementById('filter-theme')?.addEventListener('change', () => renderArticles());
    document.getElementById('sort-by')?.addEventListener('change', () => renderArticles());

    // Refresh button
    document.getElementById('btn-refresh')?.addEventListener('click', refreshArticles);

    // Modal
    document.querySelector('.modal-close')?.addEventListener('click', () => {
        document.getElementById('article-modal').classList.remove('active');
    });
    document.getElementById('article-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'article-modal') {
            document.getElementById('article-modal').classList.remove('active');
        }
    });

    // Admin forms
    document.getElementById('form-add-theme')?.addEventListener('submit', addTheme);
    document.getElementById('form-add-source')?.addEventListener('submit', addSource);
    document.getElementById('form-search-sources')?.addEventListener('submit', searchSources);

    // Admin actions
    document.getElementById('btn-fetch-all')?.addEventListener('click', fetchAllArticles);
    document.getElementById('btn-analyze-all')?.addEventListener('click', analyzeAllArticles);

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('article-modal').classList.remove('active');
        }
    });
}

// ============ Start ============

document.addEventListener('DOMContentLoaded', initApp);
