const { detectMetaPlatform, isStandardPostFormat } = require("./postFilter");

class PubblieService {
  constructor(env = {}) {
    const raw = String(env.PUBBLIE_API_KEY || "").trim();
    this.apiKey = raw.toLowerCase().includes("your_") ? "" : raw;
    this.baseUrl = "https://pubblie.io";
    this.cache = new Map();
    this.detailCache = new Map();
  }

  setApiKey(key) {
    const raw = String(key || "").trim();
    const nextKey = raw.toLowerCase().includes("your_") ? "" : raw;
    if (this.apiKey !== nextKey) {
      this.detailCache.clear();
    }
    this.apiKey = nextKey;
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
    const result = items.map(c => {
      const name = c.name || c.title || c.username || c.accountName || "Canale Social";
      const provider = (c.provider || c.type || c.platform || "").toLowerCase();
      const metaPlatform = detectMetaPlatform(provider, name);
      return {
        id: String(c.id || c.channelId),
        name,
        provider,
        metaPlatform,
        isMetaCompatible: Boolean(metaPlatform),
        imageUrl: c.avatarUrl || c.picture || c.imageUrl || c.profilePicture || null,
        accountUsername: c.username || c.screenName || "",
        isDirectPublish: Boolean(c.isDirectPublish ?? true)
      };
    });

    this.cache.set(cacheKey, { time: Date.now(), data: result });
    return result;
  }

  /**
   * Fetches raw post details from /api/v1/posts/{postId} with in-memory caching.
   * Note: Pubblie only includes `isStory`, `isReel`, `externalLink`, and `images` in the detail endpoint.
   */
  async getPostDetailsRaw(postId, apiKey) {
    if (!postId) throw new Error("postId mancante");
    const cleanId = String(postId)
      .replace(/^pub_/, "")
      .replace(/_(facebook|instagram|fb|ig)$/i, "");

    const cached = this.detailCache.get(cleanId);
    if (cached && Date.now() - cached.time < 30 * 60 * 1000) {
      return cached.data;
    }

    const raw = await this.request(`/api/v1/posts/${encodeURIComponent(cleanId)}`, { apiKey });
    const data = raw && typeof raw === "object" && raw.data && !raw.id ? raw.data : raw;

    if (data && typeof data === "object" && (data.id || data.accounts)) {
      if (this.detailCache.size > 600) {
        const firstKey = this.detailCache.keys().next().value;
        if (firstKey) this.detailCache.delete(firstKey);
      }
      this.detailCache.set(cleanId, { time: Date.now(), data });
    }
    return data;
  }

  /**
   * Lists posts for a project filtered by status and date range.
   * Automatically enriches Meta candidate posts with /api/v1/posts/{postId} details
   * so that Stories (`isStory: true`), Reels (`isReel: true`), and non-Meta accounts are 100% hidden.
   * Endpoint: GET /api/v1/projects/{projectId}/posts
   */
  async listProjectPosts(projectId, { status = "", dateFrom = "", dateTo = "" } = {}, apiKey) {
    if (!projectId) throw new Error("projectId mancante");
    
    const now = new Date();
    const fromStr = dateFrom || now.toISOString();
    const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const toStr = dateTo || futureDate.toISOString();
    const fromMs = new Date(fromStr).getTime();
    const toMs = new Date(toStr).getTime();

    const params = {
      from: fromStr,
      to: toStr,
      dateFrom: fromStr,
      dateTo: toStr
    };
    if (status) params.status = status;

    const listCacheKey = `posts_${projectId}_${fromStr.slice(0, 13)}_${toStr.slice(0, 10)}_${status}`;
    const cachedList = this.cache.get(listCacheKey);
    let items = null;
    if (cachedList && Date.now() - cachedList.time < 45000) {
      items = cachedList.data;
    } else {
      const raw = await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/posts`, {
        params,
        apiKey
      });
      items = Array.isArray(raw) ? raw : (raw.data || raw.posts || []);
      this.cache.set(listCacheKey, { time: Date.now(), data: items });
    }

    // 1. Pre-filter summary items: keep only posts within the requested date range
    // that have at least one Meta (Facebook/Instagram) account and pass summary-level format check.
    const candidates = items.filter(p => {
      if (!isStandardPostFormat(p)) return false;
      const postDateStr = p.scheduleDate || p.scheduleDateTime || p.scheduledAt || p.publishDate || p.publishedAt;
      if (postDateStr && !isNaN(fromMs)) {
        const postMs = new Date(postDateStr).getTime();
        if (!isNaN(postMs) && postMs < fromMs - 12 * 3600 * 1000) return false;
        if (!isNaN(postMs) && !isNaN(toMs) && postMs > toMs + 24 * 3600 * 1000) return false;
      }
      if (Array.isArray(p.accounts) && p.accounts.length > 0) {
        const hasMetaAcc = p.accounts.some(a =>
          detectMetaPlatform(a.provider || a.platform || a.type || "", a.accountName || a.name || "") !== null
        );
        if (!hasMetaAcc) return false;
      }
      return true;
    });

    // 2. Enrich candidates with /api/v1/posts/{postId} in parallel batches of 10
    // so we obtain `isStory`, `isReel`, `externalLink`, `images`, and full `body`.
    const detailedPosts = [];
    const batchSize = 10;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const slice = candidates.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        slice.map(async (summaryPost) => {
          try {
            const detail = await this.getPostDetailsRaw(summaryPost.id || summaryPost.postId, apiKey);
            if (detail && typeof detail === "object") {
              return { ...summaryPost, ...detail };
            }
          } catch {
            // fallback to summaryPost if detail endpoint fails
          }
          return summaryPost;
        })
      );
      detailedPosts.push(...batchResults);
    }

    // 3. Strictly filter out Stories, Reels, and posts with zero valid Meta Feed accounts
    const normalized = [];
    for (const rawPost of detailedPosts) {
      if (!isStandardPostFormat(rawPost)) continue;
      const norm = this.normalizePost(rawPost, projectId);
      if (norm.accounts && norm.accounts.length > 0) {
        normalized.push(norm);
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
    const p = await this.getPostDetailsRaw(postId, apiKey);
    return this.normalizePost(p);
  }

  /**
   * Helper to extract the most lightweight thumbnail URL from an image entry
   */
  extractBestThumbUrl(img) {
    if (!img) return "";
    if (typeof img === "string") return img.trim();
    if (typeof img === "object") {
      return String(
        img.thumbnailUrl ||
        img.thumbUrl ||
        img.thumbnail ||
        img.previewUrl ||
        img.smallUrl ||
        img.url ||
        img.src ||
        ""
      ).trim();
    }
    return "";
  }

  /**
   * Helper to normalize a Pubblie post object into a standard representation.
   * Keeps ONLY Meta (Facebook/Instagram) accounts in standard POST format (automatically hiding Stories & Reels).
   */
  normalizePost(p, projectId = "") {
    let images = [];
    if (p.thumbnailUrl || p.thumbUrl || p.previewUrl) {
      images = [String(p.thumbnailUrl || p.thumbUrl || p.previewUrl).trim()];
    } else if (Array.isArray(p.images)) {
      images = p.images.map(img => this.extractBestThumbUrl(img)).filter(Boolean);
    } else if (typeof p.images === "string" && p.images.trim()) {
      try {
        const parsed = JSON.parse(p.images);
        if (Array.isArray(parsed)) {
          images = parsed.map(img => this.extractBestThumbUrl(img)).filter(Boolean);
        }
      } catch {
        images = [p.images.trim()];
      }
    }

    if (!images.length && p.mediaUrls && Array.isArray(p.mediaUrls)) {
      images = p.mediaUrls.map(img => this.extractBestThumbUrl(img)).filter(Boolean);
    }
    if (!images.length && p.mediaUrl) {
      images = [String(p.mediaUrl).trim()];
    }

    const accounts = Array.isArray(p.accounts)
      ? p.accounts
          .filter(a => {
            const plat = detectMetaPlatform(a.provider || a.platform || a.type || "", a.accountName || a.name || "");
            if (!plat) return false;
            return isStandardPostFormat(p, a);
          })
          .map(a => ({
            provider: (a.provider || a.platform || a.type || "").toLowerCase(),
            accountName: a.accountName || a.name || a.username || "",
            channelId: String(a.channelId || a.id || ""),
            postType: "POST",
            isStory: Boolean(a.isStory || a.is_story),
            isReel: Boolean(a.isReel || a.is_reel),
            status: (a.status || p.status || "SCHEDULED").toUpperCase(),
            externalId: a.externalId || a.socialPostId || a.postId || "",
            permalink: a.externalLink || a.permalink || a.publishedUrl || a.url || ""
          }))
      : [];

    let channelIds = [];
    if (Array.isArray(p.channelIds) && p.channelIds.length > 0) {
      channelIds = p.channelIds.map(String);
    } else if (typeof p.channelIds === "string" && p.channelIds.trim()) {
      channelIds = p.channelIds.split(",").map(s => s.trim()).filter(Boolean);
    }

    const validImages = images.filter(Boolean);

    return {
      id: String(p.id || p.postId),
      projectId: String(p.projectId || p.folderId || projectId || ""),
      postType: "POST",
      text: p.body || p.text || p.content || p.caption || p.message || "",
      scheduleDateTime: p.scheduleDate || p.scheduleDateTime || p.scheduledAt || p.publishAt || null,
      publishedAt: p.publishDate || p.publishedAt || p.publishedDateTime || null,
      status: (p.status || "SCHEDULED").toUpperCase(),
      channelIds,
      accounts,
      images: validImages.slice(0, 1),
      imageCount: Number(p.imageCount || validImages.length || 0),
      hasMedia: Boolean(p.hasMedia || validImages.length > 0 || (p.imageCount && p.imageCount > 0)),
      videoIds: Array.isArray(p.videoIds) ? p.videoIds : (p.videoIds ? String(p.videoIds).split(",").map(s => s.trim()) : []),
      link: p.link || p.url || p.permalink || p.externalLink || "",
      externalId: p.externalId || p.socialPostId || "",
      customerApprovalRequired: Boolean(p.customerApprovalRequired)
    };
  }
}

module.exports = PubblieService;
