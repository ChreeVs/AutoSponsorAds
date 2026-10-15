const API_DEFAULT_VERSION = "v21.0";

class MetaService {
  constructor(config = {}) {
    this.config = config;
    this.apiVersion = config.META_API_VERSION || API_DEFAULT_VERSION;
    this.graphBase = `https://graph.facebook.com/${this.apiVersion}`;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.apiVersion = this.config.META_API_VERSION || API_DEFAULT_VERSION;
    this.graphBase = `https://graph.facebook.com/${this.apiVersion}`;
  }

  token() {
    return this.config.META_ACCESS_TOKEN;
  }

  parseNamedIds(value) {
    if (!value) return [];
    return value.split(",").map((item) => {
      const [label, id] = item.split(":");
      return { label: label?.trim(), id: id?.trim() };
    }).filter((item) => item.label && item.id);
  }

  async graph(pathname, params = {}, accessToken = this.token()) {
    if (!accessToken) {
      const error = new Error("META_ACCESS_TOKEN mancante nel file .env o nelle variabili d'ambiente");
      error.status = 400;
      throw error;
    }

    const url = new URL(`${this.graphBase}/${pathname.replace(/^\//, "")}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    });
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url);
    const payload = await response.json();

    if (!response.ok || payload.error) {
      const error = new Error(payload.error?.message || `Errore Meta API ${response.status}`);
      error.status = response.status;
      error.meta = payload.error || payload;
      throw error;
    }

    return payload;
  }

  async graphPost(pathname, params = {}, accessToken = this.token()) {
    if (!accessToken) {
      const error = new Error("META_ACCESS_TOKEN mancante nel file .env o nelle variabili d'ambiente");
      error.status = 400;
      throw error;
    }

    const url = new URL(`${this.graphBase}/${pathname.replace(/^\//, "")}`);
    const body = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        body.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
      }
    });
    body.set("access_token", accessToken);

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const payload = await response.json();

    if (!response.ok || payload.error) {
      const error = new Error(payload.error?.message || `Errore Meta API ${response.status}`);
      error.status = response.status;
      error.meta = payload.error || payload;
      throw error;
    }

    return payload;
  }

  pageTokenForId(pageId) {
    const page = this.parseNamedIds(this.config.META_FACEBOOK_PAGES).find((item) => item.id === pageId);
    if (!page) return null;
    return this.config[`META_PAGE_ACCESS_TOKEN_${page.label}`] || null;
  }

  pageTokenForInstagramId(instagramId) {
    const instagram = this.parseNamedIds(this.config.META_INSTAGRAM_ACCOUNTS).find((item) => item.id === instagramId);
    if (!instagram) return null;
    return this.config[`META_PAGE_ACCESS_TOKEN_${instagram.label}`] || null;
  }

  pageForInstagramId(instagramId) {
    const instagram = this.parseNamedIds(this.config.META_INSTAGRAM_ACCOUNTS).find((item) => item.id === instagramId);
    if (!instagram) return null;
    return this.parseNamedIds(this.config.META_FACEBOOK_PAGES).find((item) => item.label === instagram.label) || null;
  }

  async dynamicPageTokenForId(pageId) {
    if (!pageId) return null;
    try {
      const page = await this.graph(`/${pageId}`, { fields: "access_token" });
      return page.access_token || null;
    } catch {
      return null;
    }
  }

  configuredSources() {
    return {
      facebookPages: this.parseNamedIds(this.config.META_FACEBOOK_PAGES),
      instagramAccounts: this.parseNamedIds(this.config.META_INSTAGRAM_ACCOUNTS)
    };
  }

  dedupeById(items) {
    return Array.from(new Map(items.filter((item) => item.id).map((item) => [item.id, item])).values());
  }

  async listBusinessPages(businessId, edge, sourceType) {
    const payload = await this.graph(`/${businessId}/${edge}`, {
      fields: "id,name,username,instagram_business_account{id,username,name}",
      limit: "100"
    });
    const pages = payload.data || [];
    return {
      facebookPages: pages.map((page) => ({
        id: page.id,
        label: page.name || page.username || page.id,
        name: page.name || page.username || "",
        sourceType
      })),
      instagramAccounts: pages.map((page) => {
        const instagram = page.instagram_business_account;
        if (!instagram?.id) return null;
        return {
          id: instagram.id,
          label: instagram.username || instagram.name || page.name || instagram.id,
          name: instagram.name || instagram.username || "",
          pageId: page.id,
          pageName: page.name || "",
          sourceType
        };
      }).filter(Boolean)
    };
  }

  async listUserPages() {
    try {
      const payload = await this.graph("/me/accounts", {
        fields: "id,name,username,instagram_business_account{id,username,name}",
        limit: "100"
      });
      const pages = payload.data || [];
      return {
        facebookPages: pages.map((page) => ({
          id: page.id,
          label: page.name || page.username || page.id,
          name: page.name || page.username || "",
          sourceType: "user_account"
        })),
        instagramAccounts: pages.map((page) => {
          const instagram = page.instagram_business_account;
          if (!instagram?.id) return null;
          return {
            id: instagram.id,
            label: instagram.username || instagram.name || page.name || instagram.id,
            name: instagram.name || instagram.username || "",
            pageId: page.id,
            pageName: page.name || "",
            sourceType: "user_account"
          };
        }).filter(Boolean)
      };
    } catch {
      return { facebookPages: [], instagramAccounts: [] };
    }
  }

  async listSourcesForAdAccount(accountId) {
    const fallback = this.configuredSources();
    const userPages = await this.listUserPages();

    if (!accountId) {
      return {
        facebookPages: this.dedupeById([...fallback.facebookPages, ...userPages.facebookPages]),
        instagramAccounts: this.dedupeById([...fallback.instagramAccounts, ...userPages.instagramAccounts]),
        mode: "user_or_configured",
        note: "Account pubblicitario non specificato."
      };
    }

    try {
      const account = await this.graph(`/${accountId}`, { fields: "id,name,business{id,name}" });
      const businessId = account.business?.id;

      const collected = {
        facebookPages: [...userPages.facebookPages],
        instagramAccounts: [...userPages.instagramAccounts]
      };

      if (businessId) {
        for (const [edge, sourceType] of [["owned_pages", "business_owned"], ["client_pages", "business_client"]]) {
          try {
            const sources = await this.listBusinessPages(businessId, edge, sourceType);
            collected.facebookPages.push(...sources.facebookPages);
            collected.instagramAccounts.push(...sources.instagramAccounts);
          } catch {}
        }
      }

      const facebookPages = this.dedupeById([...fallback.facebookPages, ...collected.facebookPages]);
      const instagramAccounts = this.dedupeById([...fallback.instagramAccounts, ...collected.instagramAccounts]);

      return {
        facebookPages,
        instagramAccounts,
        mode: businessId ? "business" : "user_or_configured",
        business: account.business || null,
        note: businessId ? `Fonti dal Business Manager ${account.business.name || businessId}.` : "Fonti dirette dell'utente collegato."
      };
    } catch (error) {
      return {
        facebookPages: this.dedupeById([...fallback.facebookPages, ...userPages.facebookPages]),
        instagramAccounts: this.dedupeById([...fallback.instagramAccounts, ...userPages.instagramAccounts]),
        mode: "configured",
        note: `Lettura account Meta: ${error.message}`
      };
    }
  }

  async listAdAccounts() {
    const collected = [];
    // 1. Personal / direct accounts
    try {
      const payload = await this.graph("/me/adaccounts", {
        fields: "id,account_id,name,account_status,currency,timezone_name",
        limit: "100"
      });
      if (Array.isArray(payload.data)) collected.push(...payload.data);
    } catch (err) {
      console.warn("[Meta] Impossibile leggere /me/adaccounts:", err.message);
    }

    // 2. Business Manager owned and client accounts
    try {
      const bizPayload = await this.graph("/me/businesses", { fields: "id,name", limit: "50" });
      const businesses = bizPayload.data || [];
      for (const biz of businesses) {
        for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
          try {
            const bizAccounts = await this.graph(`/${biz.id}/${edge}`, {
              fields: "id,account_id,name,account_status,currency,timezone_name",
              limit: "100"
            });
            if (Array.isArray(bizAccounts.data)) collected.push(...bizAccounts.data);
          } catch {}
        }
      }
    } catch (err) {
      console.warn("[Meta] Impossibile leggere /me/businesses:", err.message);
    }

    return this.dedupeById(collected);
  }

  async getAdsetAds(adsetId) {
    if (!adsetId) return [];
    try {
      const payload = await this.graph(`/${adsetId}/ads`, {
        fields: "id,name,status,effective_status,created_time",
        limit: "100"
      });
      return payload.data || [];
    } catch (err) {
      console.warn(`[Meta] Errore conteggio ads per adset ${adsetId}:`, err.message);
      return [];
    }
  }

  async archiveAd(adId) {
    if (!adId) return;
    return await this.graphPost(`/${adId}`, { status: "ARCHIVED" });
  }

  formatDuplicateAdsetName(originalName) {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const dateFormatted = `${day}/${month}/${year}`;
    return `${originalName} - ${dateFormatted} - Copia`;
  }

  async cloneAdset(adAccountId, originalAdsetId, newName) {
    const original = await this.graph(`/${originalAdsetId}`, {
      fields: "name,campaign_id,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting,bid_amount,bid_strategy,destination_type,promoted_object,attribution_spec,tune_for_category,end_time"
    });

    const targetName = (newName && newName.trim()) || this.formatDuplicateAdsetName(original.name);

    const params = {
      name: targetName,
      campaign_id: original.campaign_id,
      optimization_goal: original.optimization_goal,
      billing_event: original.billing_event,
      targeting: original.targeting,
      status: "ACTIVE"
    };

    if (original.daily_budget) params.daily_budget = original.daily_budget;
    if (original.lifetime_budget) {
      params.lifetime_budget = original.lifetime_budget;
      if (original.end_time && new Date(original.end_time).getTime() > Date.now()) {
        params.end_time = original.end_time;
      } else {
        // Meta richiede end_time futura se impostato lifetime_budget (default +30gg)
        params.end_time = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      }
    }
    if (original.bid_amount) params.bid_amount = original.bid_amount;
    if (original.bid_strategy) params.bid_strategy = original.bid_strategy;
    if (original.destination_type) params.destination_type = original.destination_type;
    if (original.promoted_object) params.promoted_object = original.promoted_object;
    if (original.attribution_spec) params.attribution_spec = original.attribution_spec;
    if (original.tune_for_category && original.tune_for_category !== "NONE") {
      params.tune_for_category = original.tune_for_category;
    }

    const created = await this.graphPost(`/${adAccountId}/adsets`, params);
    return {
      id: created.id,
      name: targetName,
      campaign_id: original.campaign_id
    };
  }

  async listCampaigns(accountId) {
    return await this.graph(`/${accountId}/campaigns`, {
      fields: "id,name,status,effective_status,objective,created_time,updated_time",
      limit: "100"
    });
  }

  async listAdsets(accountId, campaignId = null) {
    const filtering = campaignId ? JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]) : "";
    return await this.graph(`/${accountId}/adsets`, {
      fields: "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal",
      filtering,
      limit: "100"
    });
  }

  async listRules(accountId) {
    return await this.graph(`/${accountId}/adrules_library`, {
      fields: "id,name,evaluation_spec,execution_spec,schedule_spec,status,created_time,updated_time",
      limit: "100"
    });
  }

  async findRule(accountId, ruleId) {
    if (!accountId || !ruleId) return null;
    const payload = await this.listRules(accountId);
    return (payload.data || []).find((rule) => rule.id === ruleId) || null;
  }

  parseMetaJson(value, fallback) {
    if (!value) return fallback;
    if (typeof value === "object") return structuredClone(value);
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  mergeAdIdsIntoEvaluationSpec(evaluationSpec, adIds) {
    const spec = this.parseMetaJson(evaluationSpec, {});
    const filters = Array.isArray(spec.filters) ? spec.filters : [];
    const adIdFilter = filters.find((filter) => filter.field === "ad.id" && filter.operator === "IN" && Array.isArray(filter.value));

    if (!adIdFilter) {
      return {
        updatedSpec: spec,
        changed: false,
        message: "Regola non aggiornata: questa regola non contiene una lista di ID inserzione modificabile."
      };
    }

    const existing = new Set(adIdFilter.value.map(String));
    adIds.map(String).forEach((id) => existing.add(id));
    const nextValue = Array.from(existing);
    const changed = nextValue.length !== adIdFilter.value.length;
    adIdFilter.value = nextValue;

    return {
      updatedSpec: spec,
      changed,
      message: changed
        ? "Regola applicata: ho aggiunto questa inserzione alla lista della regola."
        : "Regola gia applicata: questa inserzione era gia nella lista della regola."
    };
  }

  async applyRuleToCreatedAds(accountId, ruleId, adIds) {
    if (!ruleId || !adIds?.length) {
      return { applied: false, message: "Nessuna regola selezionata." };
    }

    const rule = await this.findRule(accountId, ruleId);
    if (!rule) {
      return { applied: false, message: "Regola non trovata nell'account pubblicitario selezionato." };
    }

    const merge = this.mergeAdIdsIntoEvaluationSpec(rule.evaluation_spec, adIds);
    if (!merge.changed) {
      return { applied: false, message: merge.message };
    }

    await this.graphPost(`/${ruleId}`, { evaluation_spec: merge.updatedSpec });
    return { applied: true, message: merge.message };
  }

  async getFacebookPosts(pageId, limit = 25) {
    const pageAccessToken = this.pageTokenForId(pageId) || await this.dynamicPageTokenForId(pageId);
    return await this.graph(`/${pageId}/posts`, {
      fields: "id,message,permalink_url,created_time,full_picture,status_type,attachments{media_type,title,description,unshimmed_url}",
      limit: String(limit)
    }, pageAccessToken || this.token());
  }

  async getInstagramMedia(instagramId, pageId = null, limit = 25) {
    const pageAccessToken = this.pageTokenForInstagramId(instagramId) || (pageId ? await this.dynamicPageTokenForId(pageId) : null);
    return await this.graph(`/${instagramId}/media`, {
      fields: "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url",
      limit: String(limit)
    }, pageAccessToken || this.token());
  }

  async checkTokenHealth() {
    try {
      const me = await this.graph("/me", { fields: "id,name" });
      const debugToken = await this.graph("/debug_token", { input_token: this.token() }).catch(() => null);
      return {
        ok: true,
        user: me,
        tokenInfo: debugToken?.data || null,
        message: "Token valido e connesso a Meta Graph API"
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message,
        meta: err.meta || null
      };
    }
  }
}

module.exports = MetaService;
