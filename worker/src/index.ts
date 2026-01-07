/**
 * Veille API - Cloudflare Worker
 * Backend pour l'agrégateur de news intelligent
 */

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  ENVIRONMENT: string;
  ASSETS: Fetcher;
}

// Types
interface Theme {
  id: number;
  name: string;
  description?: string;
  keywords?: string;
  is_active: number;
  created_at: string;
}

interface Source {
  id: number;
  theme_id: number;
  name: string;
  url: string;
  feed_url?: string;
  source_type: string;
  is_active: number;
  quality_score: number;
  last_fetched_at?: string;
}

interface Article {
  id: number;
  source_id: number;
  title: string;
  url: string;
  content?: string;
  summary?: string;
  key_points?: string;
  tags?: string;
  relevance_score?: number;
  published_at?: string;
  fetched_at: string;
  analyzed_at?: string;
  is_favorite: number;
  user_rating?: number;
  source_name?: string;
  theme_name?: string;
  theme_id?: number;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helper: JSON response
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// Helper: Error response
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// Router
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API Routes
    if (path.startsWith('/api/')) {
      try {
        // Themes
        if (path === '/api/themes' && method === 'GET') {
          return await getThemes(env);
        }
        if (path === '/api/themes' && method === 'POST') {
          return await createTheme(request, env);
        }
        if (path.match(/^\/api\/themes\/\d+$/) && method === 'PUT') {
          const id = parseInt(path.split('/')[3]);
          return await updateTheme(id, request, env);
        }
        if (path.match(/^\/api\/themes\/\d+$/) && method === 'DELETE') {
          const id = parseInt(path.split('/')[3]);
          return await deleteTheme(id, env);
        }

        // Sources
        if (path === '/api/sources' && method === 'GET') {
          const themeId = url.searchParams.get('theme_id');
          return await getSources(env, themeId ? parseInt(themeId) : undefined);
        }
        if (path === '/api/sources' && method === 'POST') {
          return await createSource(request, env);
        }
        if (path.match(/^\/api\/sources\/\d+$/) && method === 'DELETE') {
          const id = parseInt(path.split('/')[3]);
          return await deleteSource(id, env);
        }
        if (path.match(/^\/api\/sources\/\d+\/toggle$/) && method === 'POST') {
          const id = parseInt(path.split('/')[3]);
          return await toggleSource(id, env);
        }

        // Articles
        if (path === '/api/articles' && method === 'GET') {
          const themeId = url.searchParams.get('theme_id');
          const limit = url.searchParams.get('limit') || '50';
          return await getArticles(env, themeId ? parseInt(themeId) : undefined, parseInt(limit));
        }
        if (path.match(/^\/api\/articles\/\d+\/rate$/) && method === 'POST') {
          const id = parseInt(path.split('/')[3]);
          return await rateArticle(id, request, env);
        }
        if (path.match(/^\/api\/articles\/\d+\/favorite$/) && method === 'POST') {
          const id = parseInt(path.split('/')[3]);
          return await toggleFavorite(id, env);
        }

        // Suggestions
        if (path === '/api/suggestions' && method === 'GET') {
          return await getSuggestions(env);
        }
        if (path.match(/^\/api\/suggestions\/\d+\/accept$/) && method === 'POST') {
          const id = parseInt(path.split('/')[3]);
          return await acceptSuggestion(id, env);
        }
        if (path.match(/^\/api\/suggestions\/\d+\/reject$/) && method === 'POST') {
          const id = parseInt(path.split('/')[3]);
          return await rejectSuggestion(id, env);
        }

        // Actions
        if (path === '/api/fetch' && method === 'POST') {
          return await fetchAllSources(env);
        }
        if (path === '/api/analyze' && method === 'POST') {
          return await analyzeArticles(env);
        }
        if (path === '/api/search-sources' && method === 'POST') {
          return await searchSources(request, env);
        }

        // Stats
        if (path === '/api/stats' && method === 'GET') {
          return await getStats(env);
        }

        return errorResponse('Not found', 404);
      } catch (e) {
        console.error(e);
        return errorResponse(`Server error: ${e}`, 500);
      }
    }

    // Serve static assets via ASSETS binding
    return env.ASSETS.fetch(request);
  },
};

// ============ THEMES ============

async function getThemes(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM themes WHERE is_active = 1 ORDER BY name'
  ).all<Theme>();
  return jsonResponse(results);
}

async function createTheme(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { name: string; description?: string; keywords?: string[] };
  const { name, description, keywords } = body;

  if (!name) {
    return errorResponse('Name is required');
  }

  const result = await env.DB.prepare(
    'INSERT INTO themes (name, description, keywords) VALUES (?, ?, ?)'
  ).bind(name, description || '', JSON.stringify(keywords || [])).run();

  const theme = await env.DB.prepare('SELECT * FROM themes WHERE id = ?')
    .bind(result.meta.last_row_id).first<Theme>();

  return jsonResponse(theme, 201);
}

async function updateTheme(id: number, request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { name?: string; description?: string; keywords?: string[]; is_active?: boolean };

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description);
  }
  if (body.keywords !== undefined) {
    updates.push('keywords = ?');
    values.push(JSON.stringify(body.keywords));
  }
  if (body.is_active !== undefined) {
    updates.push('is_active = ?');
    values.push(body.is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return errorResponse('No updates provided');
  }

  updates.push('updated_at = datetime("now")');
  values.push(id);

  await env.DB.prepare(
    `UPDATE themes SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  const theme = await env.DB.prepare('SELECT * FROM themes WHERE id = ?').bind(id).first<Theme>();
  return jsonResponse(theme);
}

async function deleteTheme(id: number, env: Env): Promise<Response> {
  await env.DB.prepare('DELETE FROM themes WHERE id = ?').bind(id).run();
  return jsonResponse({ success: true });
}

// ============ SOURCES ============

async function getSources(env: Env, themeId?: number): Promise<Response> {
  let query = `
    SELECT s.*, t.name as theme_name
    FROM sources s
    JOIN themes t ON s.theme_id = t.id
  `;
  const params: unknown[] = [];

  if (themeId) {
    query += ' WHERE s.theme_id = ?';
    params.push(themeId);
  }

  query += ' ORDER BY s.name';

  const stmt = params.length > 0
    ? env.DB.prepare(query).bind(...params)
    : env.DB.prepare(query);

  const { results } = await stmt.all();
  return jsonResponse(results);
}

async function createSource(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    theme_id: number;
    name: string;
    url: string;
    feed_url?: string;
    source_type?: string;
  };

  const { theme_id, name, url, feed_url, source_type } = body;

  if (!theme_id || !name || !url) {
    return errorResponse('theme_id, name, and url are required');
  }

  // Try to discover feed URL if not provided
  let finalFeedUrl = feed_url || url;
  if (!feed_url) {
    const discovered = await discoverFeedUrl(url);
    if (discovered) {
      finalFeedUrl = discovered;
    }
  }

  const result = await env.DB.prepare(
    'INSERT INTO sources (theme_id, name, url, feed_url, source_type) VALUES (?, ?, ?, ?, ?)'
  ).bind(theme_id, name, url, finalFeedUrl, source_type || 'rss').run();

  const source = await env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(result.meta.last_row_id).first();

  return jsonResponse(source, 201);
}

async function deleteSource(id: number, env: Env): Promise<Response> {
  await env.DB.prepare('DELETE FROM sources WHERE id = ?').bind(id).run();
  return jsonResponse({ success: true });
}

async function toggleSource(id: number, env: Env): Promise<Response> {
  await env.DB.prepare(
    'UPDATE sources SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?'
  ).bind(id).run();

  const source = await env.DB.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first();
  return jsonResponse(source);
}

// ============ ARTICLES ============

async function getArticles(env: Env, themeId?: number, limit = 50): Promise<Response> {
  let query = `
    SELECT a.*, s.name as source_name, t.name as theme_name, t.id as theme_id
    FROM articles a
    JOIN sources s ON a.source_id = s.id
    JOIN themes t ON s.theme_id = t.id
    WHERE a.is_hidden = 0
  `;
  const params: unknown[] = [];

  if (themeId) {
    query += ' AND t.id = ?';
    params.push(themeId);
  }

  query += ' ORDER BY COALESCE(a.relevance_score, 0) DESC, a.published_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query).bind(...params);
  const { results } = await stmt.all<Article>();

  // Parse JSON fields
  const articles = results.map(a => ({
    ...a,
    key_points: a.key_points ? JSON.parse(a.key_points) : [],
    tags: a.tags ? JSON.parse(a.tags) : [],
  }));

  return jsonResponse(articles);
}

async function rateArticle(id: number, request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { rating: number };
  const { rating } = body; // -1, 0, or 1

  await env.DB.prepare('UPDATE articles SET user_rating = ? WHERE id = ?')
    .bind(rating, id).run();

  // Update source quality score
  const article = await env.DB.prepare('SELECT source_id FROM articles WHERE id = ?')
    .bind(id).first<{ source_id: number }>();

  if (article) {
    const adjustment = rating > 0 ? 0.02 : rating < 0 ? -0.02 : 0;
    await env.DB.prepare(
      'UPDATE sources SET quality_score = MIN(1.0, MAX(0.0, quality_score + ?)) WHERE id = ?'
    ).bind(adjustment, article.source_id).run();
  }

  return jsonResponse({ success: true });
}

async function toggleFavorite(id: number, env: Env): Promise<Response> {
  await env.DB.prepare(
    'UPDATE articles SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?'
  ).bind(id).run();

  const article = await env.DB.prepare('SELECT is_favorite FROM articles WHERE id = ?')
    .bind(id).first<{ is_favorite: number }>();

  return jsonResponse({ is_favorite: article?.is_favorite === 1 });
}

// ============ SUGGESTIONS ============

async function getSuggestions(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`
    SELECT ss.*, t.name as theme_name
    FROM suggested_sources ss
    JOIN themes t ON ss.theme_id = t.id
    WHERE ss.status = 'pending'
    ORDER BY ss.created_at DESC
  `).all();
  return jsonResponse(results);
}

async function acceptSuggestion(id: number, env: Env): Promise<Response> {
  const suggestion = await env.DB.prepare(
    'SELECT * FROM suggested_sources WHERE id = ? AND status = "pending"'
  ).bind(id).first<{
    theme_id: number;
    name: string;
    url: string;
    feed_url?: string;
  }>();

  if (!suggestion) {
    return errorResponse('Suggestion not found or already processed', 404);
  }

  // Create the source
  await env.DB.prepare(
    'INSERT INTO sources (theme_id, name, url, feed_url, is_suggested) VALUES (?, ?, ?, ?, 1)'
  ).bind(suggestion.theme_id, suggestion.name, suggestion.url, suggestion.feed_url || suggestion.url).run();

  // Update suggestion status
  await env.DB.prepare('UPDATE suggested_sources SET status = "accepted" WHERE id = ?').bind(id).run();

  return jsonResponse({ success: true });
}

async function rejectSuggestion(id: number, env: Env): Promise<Response> {
  await env.DB.prepare('UPDATE suggested_sources SET status = "rejected" WHERE id = ?').bind(id).run();
  return jsonResponse({ success: true });
}

// ============ ACTIONS ============

async function fetchAllSources(env: Env): Promise<Response> {
  const { results: sources } = await env.DB.prepare(
    'SELECT * FROM sources WHERE is_active = 1'
  ).all<Source>();

  let totalAdded = 0;
  const errors: string[] = [];

  for (const source of sources) {
    try {
      const articles = await fetchRssFeed(source.feed_url || source.url);

      for (const article of articles) {
        // Check if article already exists
        const existing = await env.DB.prepare(
          'SELECT id FROM articles WHERE url = ?'
        ).bind(article.url).first();

        if (!existing && article.url) {
          await env.DB.prepare(`
            INSERT INTO articles (source_id, title, url, content, author, published_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            source.id,
            article.title,
            article.url,
            article.content || '',
            article.author || '',
            article.published_at || new Date().toISOString()
          ).run();
          totalAdded++;
        }
      }

      // Update last fetched
      await env.DB.prepare(
        'UPDATE sources SET last_fetched_at = datetime("now") WHERE id = ?'
      ).bind(source.id).run();

    } catch (e) {
      errors.push(`${source.name}: ${e}`);
    }
  }

  return jsonResponse({
    success: true,
    articles_added: totalAdded,
    sources_processed: sources.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

async function analyzeArticles(env: Env): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return errorResponse('ANTHROPIC_API_KEY not configured', 500);
  }

  const { results: articles } = await env.DB.prepare(`
    SELECT a.*, t.keywords as theme_keywords
    FROM articles a
    JOIN sources s ON a.source_id = s.id
    JOIN themes t ON s.theme_id = t.id
    WHERE a.analyzed_at IS NULL
    LIMIT 20
  `).all<Article & { theme_keywords?: string }>();

  let analyzedCount = 0;
  const errors: string[] = [];

  // Get user preferences for context
  const { results: prefs } = await env.DB.prepare(
    'SELECT * FROM user_preferences'
  ).all<{ preference_type: string; value: string }>();

  const prefContext = buildPreferenceContext(prefs);

  for (const article of articles) {
    try {
      const analysis = await analyzeWithClaude(
        env.ANTHROPIC_API_KEY,
        article,
        article.theme_keywords,
        prefContext
      );

      await env.DB.prepare(`
        UPDATE articles
        SET summary = ?, key_points = ?, tags = ?, relevance_score = ?, analyzed_at = datetime("now")
        WHERE id = ?
      `).bind(
        analysis.summary,
        JSON.stringify(analysis.key_points),
        JSON.stringify(analysis.tags),
        analysis.relevance_score,
        article.id
      ).run();

      analyzedCount++;
    } catch (e) {
      errors.push(`Article ${article.id}: ${e}`);
    }
  }

  return jsonResponse({
    success: true,
    analyzed_count: analyzedCount,
    errors: errors.length > 0 ? errors : undefined,
  });
}

async function searchSources(request: Request, env: Env): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return errorResponse('ANTHROPIC_API_KEY not configured', 500);
  }

  const body = await request.json() as { theme_id: number; count?: number };
  const { theme_id, count = 5 } = body;

  const theme = await env.DB.prepare('SELECT * FROM themes WHERE id = ?')
    .bind(theme_id).first<Theme>();

  if (!theme) {
    return errorResponse('Theme not found', 404);
  }

  const suggestions = await searchSourcesWithClaude(
    env.ANTHROPIC_API_KEY,
    theme,
    count
  );

  // Save suggestions to database
  for (const suggestion of suggestions) {
    await env.DB.prepare(`
      INSERT INTO suggested_sources (theme_id, name, url, feed_url, description, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      theme_id,
      suggestion.name,
      suggestion.url,
      suggestion.feed_url || null,
      suggestion.description || null,
      suggestion.reason || null
    ).run();
  }

  return jsonResponse({
    success: true,
    suggestions_count: suggestions.length,
    suggestions,
  });
}

async function getStats(env: Env): Promise<Response> {
  const themes = await env.DB.prepare('SELECT COUNT(*) as count FROM themes WHERE is_active = 1').first<{ count: number }>();
  const sources = await env.DB.prepare('SELECT COUNT(*) as count FROM sources WHERE is_active = 1').first<{ count: number }>();
  const articles = await env.DB.prepare('SELECT COUNT(*) as count FROM articles').first<{ count: number }>();
  const analyzed = await env.DB.prepare('SELECT COUNT(*) as count FROM articles WHERE analyzed_at IS NOT NULL').first<{ count: number }>();
  const suggestions = await env.DB.prepare('SELECT COUNT(*) as count FROM suggested_sources WHERE status = "pending"').first<{ count: number }>();

  return jsonResponse({
    themes: themes?.count || 0,
    sources: sources?.count || 0,
    articles: articles?.count || 0,
    analyzed: analyzed?.count || 0,
    pending_suggestions: suggestions?.count || 0,
    generated_at: new Date().toISOString(),
  });
}

// ============ HELPERS ============

async function fetchRssFeed(feedUrl: string): Promise<Array<{
  title: string;
  url: string;
  content?: string;
  author?: string;
  published_at?: string;
}>> {
  const response = await fetch(feedUrl, {
    headers: { 'User-Agent': 'Veille/1.0 (News Aggregator)' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`);
  }

  const text = await response.text();

  // Simple RSS/Atom parser
  const articles: Array<{
    title: string;
    url: string;
    content?: string;
    author?: string;
    published_at?: string;
  }> = [];

  // RSS 2.0
  const itemMatches = text.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    const item = match[1];
    const title = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)?.[1] || '';
    const link = item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i)?.[1] || '';
    const description = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] || '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1];
    const author = item.match(/<author>(.*?)<\/author>/i)?.[1] ||
                   item.match(/<dc:creator>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/dc:creator>/i)?.[1];

    if (title && link) {
      articles.push({
        title: decodeHtmlEntities(title),
        url: link.trim(),
        content: decodeHtmlEntities(stripHtml(description)),
        author: author ? decodeHtmlEntities(author) : undefined,
        published_at: pubDate ? new Date(pubDate).toISOString() : undefined,
      });
    }
  }

  // Atom
  if (articles.length === 0) {
    const entryMatches = text.matchAll(/<entry>([\s\S]*?)<\/entry>/gi);
    for (const match of entryMatches) {
      const entry = match[1];
      const title = entry.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)?.[1] || '';
      const link = entry.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>|<link[^>]*>([^<]+)<\/link>/i)?.[1] || '';
      const summary = entry.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i)?.[1] ||
                      entry.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i)?.[1] || '';
      const updated = entry.match(/<updated>(.*?)<\/updated>/i)?.[1] ||
                      entry.match(/<published>(.*?)<\/published>/i)?.[1];
      const author = entry.match(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/i)?.[1];

      if (title && link) {
        articles.push({
          title: decodeHtmlEntities(title),
          url: link.trim(),
          content: decodeHtmlEntities(stripHtml(summary)),
          author: author ? decodeHtmlEntities(author) : undefined,
          published_at: updated ? new Date(updated).toISOString() : undefined,
        });
      }
    }
  }

  return articles.slice(0, 20);
}

async function discoverFeedUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Veille/1.0 (News Aggregator)' },
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Look for RSS/Atom links in HTML
    const feedLink = html.match(/<link[^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i)?.[2] ||
                     html.match(/<link[^>]*href=["']([^"']+)["'][^>]*type=["']application\/(rss|atom)\+xml["']/i)?.[1];

    if (feedLink) {
      // Make absolute URL if relative
      if (feedLink.startsWith('/')) {
        const urlObj = new URL(url);
        return `${urlObj.origin}${feedLink}`;
      }
      return feedLink;
    }

    // Try common feed paths
    const urlObj = new URL(url);
    const commonPaths = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml'];

    for (const path of commonPaths) {
      const feedUrl = `${urlObj.origin}${path}`;
      try {
        const feedResponse = await fetch(feedUrl, { method: 'HEAD' });
        if (feedResponse.ok) {
          return feedUrl;
        }
      } catch {
        // Continue to next path
      }
    }

    return null;
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function buildPreferenceContext(prefs: Array<{ preference_type: string; value: string }>): string {
  const likes = prefs.filter(p => p.preference_type === 'like').map(p => p.value);
  const dislikes = prefs.filter(p => p.preference_type === 'dislike').map(p => p.value);

  const parts: string[] = [];
  if (likes.length > 0) {
    parts.push(`L'utilisateur apprécie : ${likes.join(', ')}`);
  }
  if (dislikes.length > 0) {
    parts.push(`L'utilisateur n'apprécie pas : ${dislikes.join(', ')}`);
  }

  return parts.join('\n');
}

async function analyzeWithClaude(
  apiKey: string,
  article: Article,
  themeKeywords?: string,
  prefContext?: string
): Promise<{
  summary: string;
  key_points: string[];
  tags: string[];
  relevance_score: number;
}> {
  const content = (article.content || '').slice(0, 10000);

  const systemPrompt = `Tu es un assistant spécialisé dans l'analyse d'articles de veille technologique.
Tu dois analyser l'article fourni et produire :
1. Un résumé concis (2-3 phrases, max 300 caractères)
2. Les points clés (3-5 points importants)
3. Des tags pertinents (3-7 mots-clés)
4. Un score de pertinence de 0.0 à 1.0

Réponds UNIQUEMENT en JSON valide avec cette structure exacte :
{"summary": "...", "key_points": ["point 1", "point 2"], "tags": ["tag1", "tag2"], "relevance_score": 0.X}`;

  let userPrompt = `Analyse cet article :

Titre : ${article.title}

Contenu :
${content}
`;

  if (themeKeywords) {
    const keywords = JSON.parse(themeKeywords);
    if (keywords.length > 0) {
      userPrompt += `\nMots-clés du thème : ${keywords.join(', ')}\n`;
    }
  }

  if (prefContext) {
    userPrompt += `\nPréférences de l'utilisateur :\n${prefContext}\n`;
  }

  userPrompt += '\nRéponds en JSON uniquement.';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
  };

  let responseText = data.content[0]?.text || '';

  // Clean up JSON if wrapped in markdown
  if (responseText.includes('```json')) {
    responseText = responseText.split('```json')[1].split('```')[0];
  } else if (responseText.includes('```')) {
    responseText = responseText.split('```')[1].split('```')[0];
  }

  const result = JSON.parse(responseText.trim());

  return {
    summary: (result.summary || '').slice(0, 300),
    key_points: result.key_points || [],
    tags: result.tags || [],
    relevance_score: Math.max(0, Math.min(1, parseFloat(result.relevance_score) || 0.5)),
  };
}

async function searchSourcesWithClaude(
  apiKey: string,
  theme: Theme,
  count: number
): Promise<Array<{
  name: string;
  url: string;
  feed_url?: string;
  description?: string;
  reason?: string;
}>> {
  const keywords = theme.keywords ? JSON.parse(theme.keywords) : [];

  const prompt = `Tu es un expert en veille technologique. Je cherche des sources d'information de qualité sur le thème "${theme.name}".

${theme.description ? `Description du thème : ${theme.description}` : ''}
${keywords.length > 0 ? `Mots-clés associés : ${keywords.join(', ')}` : ''}

Suggère ${count} sources de qualité (blogs, sites d'actualité, newsletters) avec flux RSS de préférence.

Pour chaque source, fournis :
- name: Nom de la source
- url: URL du site principal
- feed_url: URL du flux RSS si connu (sinon null)
- description: Brève description (1 phrase)
- reason: Pourquoi cette source est pertinente

Réponds UNIQUEMENT en JSON valide avec cette structure :
{"sources": [{"name": "...", "url": "...", "feed_url": "..." ou null, "description": "...", "reason": "..."}]}

Privilégie les sources avec contenu récent et régulier, en français ET anglais.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
  };

  let responseText = data.content[0]?.text || '';

  if (responseText.includes('```json')) {
    responseText = responseText.split('```json')[1].split('```')[0];
  } else if (responseText.includes('```')) {
    responseText = responseText.split('```')[1].split('```')[0];
  }

  const result = JSON.parse(responseText.trim());
  const sources = result.sources || [];

  // Validate each source URL
  const validatedSources = [];
  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Veille/1.0' },
      });
      if (response.ok) {
        // Try to discover feed URL if not provided
        if (!source.feed_url) {
          source.feed_url = await discoverFeedUrl(source.url);
        }
        validatedSources.push(source);
      }
    } catch {
      // Skip invalid sources
    }
  }

  return validatedSources;
}
