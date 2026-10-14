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

  async listSourcesForAdAccount(accountId) {
    const fallback = this.configuredSources();
    if (!accountId) return { ...fallback, mode: "configured", note: "Account pubblicitario non selezionato." };

    try {
      const account = await this.graph(`/${accountId}`, { fields: "id,name,business{id,name}" });
      const businessId = account.business?.id;
      if (!businessId) {
        return { ...fallback, mode: "configured", note: "Questo account non espone un Business Manager collegato: uso le fonti configurate." };
      }

      const collected = { facebookPages: [], instagramAccounts: [] };
      const errors = [];
      for (const [edge, sourceType] of [["owned_pages", "business_owned"], ["client_pages", "business_client"]]) {
        try {
          const sources = await this.listBusinessPages(businessId, edge, sourceType);
          collected.facebookPages.push(...sources.facebookPages);
          collected.instagramAccounts.push(...sources.instagramAccounts);
        } catch (error) {
          errors.push(`${edge}: ${error.message}`);
        }
      }

      const facebookPages = this.dedupeById(collected.facebookPages);
      const instagramAccounts = this.dedupeById(collected.instagramAccounts);
      if (!facebookPages.length && !instagramAccounts.length) {
        return {
          ...fallback,
          mode: "configured",
          note: errors.length ? `Meta non ha restituito pagine dal business: ${errors.join(" | ")}` : "Nessuna pagina business trovata: uso le fonti configurate."
        };
      }

      return {
        facebookPages,
        instagramAccounts,
        mode: "business",
        business: account.business,
        note: `Fonti prese dal Business Manager ${account.business.name || businessId}.`
      };
    } catch (error) {
      return { ...fallback, mode: "configured", note: `Non riesco a leggere il business dell'account: ${error.message}` };
    }
  }

  async listAdAccounts() {
    const payload = await this.graph("/me/adaccounts", {
      fields: "id,account_id,name,account_status,currency,timezone_name"
    });
    return payload.data || [];
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
