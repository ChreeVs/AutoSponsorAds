const https = require("https");

class PubblieService {
  constructor(env = {}) {
    this.apiKey = env.PUBBLIE_API_KEY || "";
    this.baseUrl = "https://pubblie.io";
    this.cache = new Map();
  }

  setApiKey(key) {
    this.apiKey = (key || "").trim();
    this.cache.clear();
  }

  getApiKey() {
    return this.apiKey;
  }

  /**
   * Internal request wrapper for Pubblie API
   */
  async request(path, options = {}) {
    const key = options.apiKey || this.apiKey;
    if (!key) {
      throw new Error("Chiave API Pubblie non configurata. Inserisci la tua API Key di Pubblie.");
    }

    const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path}`);
    
    // Append query parameters if provided
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers = {
      "Accept": "application/json",
      "X-Api-Key": key,
      "Authorization": `Bearer ${key}`,
      ...(options.headers || {})
    };

    if (options.body && typeof options.body === "object") {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url.toString(), {
      method: options.method || "GET",
      headers,
      body: options.body ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : undefined
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg = data.title || data.message || data.error || (data.errors ? JSON.stringify(data.errors) : `Errore HTTP Pubblie ${res.status}`);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  /**
   * Verifies the API Key by fetching user and team identity
   * Endpoint: GET /api/v1/me
   */
  async checkConnection(apiKey) {
    try {
      const user = await this.request("/api/v1/me", { apiKey });
      return {
        ok: true,
        user: {
          id: user.id || user.userId,
          name: user.name || user.email || user.username || "Utente Pubblie",
          email: user.email || "",
          teams: user.teams || user.accessibleTeams || []
        }
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message,
        status: err.status || 500
      };
    }
  }

  /**
   * Lists all projects accessible with the API key
   * Endpoint: GET /api/v1/projects
   */
  async listProjects(apiKey, force = false) {
    const cacheKey = `projects_${apiKey || this.apiKey}`;
    const cached = this.cache.get(cacheKey);
    if (!force && cached && Date.now() - cached.time < 60000) {
      return cached.data;
    }

    const raw = await this.request("/api/v1/projects", { apiKey });
    
    // Pubblie returns an array of team groups: [ { teamId, teamName, projects: [ ... ] } ]
    let list = [];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item && Array.isArray(item.projects)) {
          for (const p of item.projects) {
            list.push({ ...p, teamName: item.teamName || item.name || "" });
          }
        } else if (item && (item.id || item.projectId)) {
          list.push(item);
        }
      }
    } else if (raw && Array.isArray(raw.data)) {
      list = raw.data;
    } else if (raw && Array.isArray(raw.projects)) {
      list = raw.projects;
    } else if (raw && typeof raw === "object") {
      for (const key of Object.keys(raw)) {
        if (Array.isArray(raw[key])) {
          for (const item of raw[key]) {
            if (item && Array.isArray(item.projects)) {
              list.push(...item.projects.map(p => ({ ...p, teamName: item.name || item.teamName })));
            } else if (item && (item.id || item.projectId)) {
              list.push(item);
            }
          }
        }
      }
    }

    const result = list.map(p => ({
      id: String(p.id || p.projectId),
      name: p.name || p.title || `Progetto ${p.id}`,
      description: p.description || "",
      teamName: p.teamName || p.team?.name || ""
    }));

    this.cache.set(cacheKey, { time: Date.now(), data: result });
    return result;
  }

  /**
   * Lists social channels for a project
   * Endpoint: GET /api/v1/projects/{projectId}/channels
   */
  async listProjectChannels(projectId, apiKey, force = false) {
    if (!projectId) throw new Error("projectId mancante");
    const cacheKey = `channels_${projectId}_${apiKey || this.apiKey}`;
    const cached = this.cache.get(cacheKey);
    if (!force && cached && Date.now() - cached.time < 60000) {
      return cached.data;
    }

    const raw = await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/channels`, { apiKey });
    
    const items = Array.isArray(raw) ? raw : (raw.data || raw.channels || []);
    const result = items.map(c => ({
      id: String(c.id || c.channelId),
      name: c.name || c.title || c.username || c.accountName || "Canale Social",
      provider: (c.provider || c.type || c.platform || "").toLowerCase(), // 'facebook', 'instagram', 'instagram-direct', 'youtube', etc.
      imageUrl: c.avatarUrl || c.picture || c.imageUrl || c.profilePicture || null,
      accountUsername: c.username || c.screenName || "",
      isDirectPublish: Boolean(c.isDirectPublish ?? true)
    }));

    this.cache.set(cacheKey, { time: Date.now(), data: result });
    return result;
  }

  /**
   * Lists posts for a project filtered by status and date range
   * Endpoint: GET /api/v1/projects/{projectId}/posts
   * Query: status (DRAFT, SCHEDULED, PUBLISHED, PUBLISHING, ERROR), dateFrom, dateTo
   */
  async listProjectPosts(projectId, { status = "", dateFrom = "", dateTo = "" } = {}, apiKey) {
    if (!projectId) throw new Error("projectId mancante");
    
    // Default date range: from today to +30 days if not set
    const now = new Date();
    const fromStr = dateFrom || now.toISOString();
    const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const toStr = dateTo || futureDate.toISOString();

    const params = {
      from: fromStr,
      to: toStr,
      dateFrom: fromStr,
      dateTo: toStr
    };
    if (status) params.status = status;

    const raw = await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/posts`, {
      params,
      apiKey
    });

    const items = Array.isArray(raw) ? raw : (raw.data || raw.posts || []);
    const normalized = items.map(p => this.normalizePost(p, projectId));

    // Fast detail enrichment for upcoming posts to extract S3 image thumbnails (max 5 posts sequentially to avoid 429)
    const needImages = normalized.filter(p => (!p.images || p.images.length === 0) && (p.imageCount > 0 || p.hasMedia)).slice(0, 5);
    if (needImages.length > 0) {
      for (const post of needImages) {
        try {
          const detail = await this.getPostDetails(post.id, apiKey);
          if (detail && detail.images && detail.images.length) {
            post.images = detail.images;
          }
        } catch {
          // ignore individual fetch errors
        }
      }
    }

    return normalized;
  }

  /**
   * Gets details for a single post
   * Endpoint: GET /api/v1/posts/{postId}
   */
  async getPostDetails(postId, apiKey) {
    if (!postId) throw new Error("postId mancante");
    const p = await this.request(`/api/v1/posts/${encodeURIComponent(postId)}`, { apiKey });
    return this.normalizePost(p);
  }

  /**
   * Helper to normalize a Pubblie post object into a standard representation
   */
  normalizePost(p, projectId = "") {
    let images = [];
    if (Array.isArray(p.images)) {
      images = p.images.map(img => typeof img === "string" ? img : (img.url || img.src || ""));
    } else if (typeof p.images === "string" && p.images.trim()) {
      try {
        const parsed = JSON.parse(p.images);
        if (Array.isArray(parsed)) {
          images = parsed.map(img => typeof img === "string" ? img : (img.url || img.src || ""));
        }
      } catch {
        images = [p.images];
      }
    }

    if (!images.length && p.mediaUrls && Array.isArray(p.mediaUrls)) {
      images = p.mediaUrls;
    }
    if (!images.length && p.mediaUrl) {
      images = [p.mediaUrl];
    }

    let channelIds = [];
    if (Array.isArray(p.channelIds)) {
      channelIds = p.channelIds.map(String);
    } else if (typeof p.channelIds === "string") {
      channelIds = p.channelIds.split(",").map(s => s.trim()).filter(Boolean);
    } else if (Array.isArray(p.accounts)) {
      channelIds = p.accounts.map(a => String(a.channelId || a.id || a.accountName || a.provider)).filter(Boolean);
    }

    const accounts = Array.isArray(p.accounts) ? p.accounts.map(a => ({
      provider: a.provider || "meta",
      accountName: a.accountName || a.name || "",
      channelId: String(a.channelId || a.id || "")
    })) : [];

    return {
      id: String(p.id || p.postId),
      projectId: String(p.projectId || projectId || ""),
      text: p.body || p.text || p.content || p.caption || p.message || "",
      scheduleDateTime: p.scheduleDate || p.scheduleDateTime || p.scheduledAt || p.publishAt || null,
      publishedAt: p.publishDate || p.publishedAt || p.publishedDateTime || null,
      status: (p.status || "SCHEDULED").toUpperCase(),
      channelIds,
      accounts,
      images: images.filter(Boolean),
      imageCount: Number(p.imageCount || images.length || 0),
      hasMedia: Boolean(p.hasMedia || images.length > 0 || (p.imageCount && p.imageCount > 0)),
      videoIds: Array.isArray(p.videoIds) ? p.videoIds : (p.videoIds ? String(p.videoIds).split(",").map(s => s.trim()) : []),
      link: p.link || p.url || "",
      customerApprovalRequired: Boolean(p.customerApprovalRequired)
    };
  }
}

module.exports = PubblieService;
