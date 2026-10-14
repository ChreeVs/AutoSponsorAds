const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const MetaService = require("./metaService");
const AutomationEngine = require("./automationEngine");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const env = { ...loadEnv(path.join(ROOT, ".env")), ...process.env };
const CRON_SECRET = env.CRON_SECRET || "";

const metaService = new MetaService(env);
const engine = new AutomationEngine(metaService);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return acc;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function checkCronAuth(req, url) {
  if (!CRON_SECRET) return true;
  const authHeader = req.headers.authorization || "";
  if (authHeader === `Bearer ${CRON_SECRET}`) return true;
  if (url.searchParams.get("secret") === CRON_SECRET) return true;
  return false;
}

async function handleApi(req, res, url) {
  try {
    // -------------------------------------------------------------------------
    // CRON ENDPOINT (for Render.com free tier via Cron-job.org or GitHub Actions)
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/cron/check-and-sponsor" && (req.method === "POST" || req.method === "GET")) {
      if (!checkCronAuth(req, url)) {
        return json(res, 401, { error: "Non autorizzato: token CRON_SECRET errato o mancante." });
      }
      const forceAll = url.searchParams.get("force") === "true";
      const result = await engine.runAllDueAutomations("EXTERNAL_CRON", forceAll);
      return json(res, 200, { ok: true, timestamp: new Date().toISOString(), result });
    }

    // -------------------------------------------------------------------------
    // SYSTEM STATUS & HEALTH
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/status" && req.method === "GET") {
      const automations = await db.getAutomations();
      const tokenHealth = await metaService.checkTokenHealth();
      return json(res, 200, {
        dbType: db.getDbType(),
        totalAutomations: automations.length,
        activeAutomations: automations.filter(a => a.enabled).length,
        cronSecretConfigured: Boolean(CRON_SECRET),
        appId: env.META_APP_ID || null,
        hasAppSecret: Boolean(env.META_APP_SECRET),
        hasToken: Boolean(metaService.token()),
        tokenHealth,
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version
      });
    }

    // -------------------------------------------------------------------------
    // MANUAL TOKEN SAVE
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/meta/save-token" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.token) return json(res, 400, { error: "Token non fornito" });
      const cleanToken = body.token.trim();
      await db.setSetting("META_ACCESS_TOKEN", cleanToken);
      metaService.updateConfig({ META_ACCESS_TOKEN: cleanToken });
      const health = await metaService.checkTokenHealth();
      return json(res, 200, { ok: true, health });
    }

    // -------------------------------------------------------------------------
    // AUTOMATIONS CRUD & EXECUTION
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/automations" && req.method === "GET") {
      const list = await db.getAutomations();
      return json(res, 200, { data: list });
    }

    if (url.pathname === "/api/automations" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.name || !body.platform || !body.source_id || !body.ad_account_id || !body.campaign_id || !body.adset_id) {
        return json(res, 400, { error: "Campi obbligatori mancanti: nome, piattaforma, fonte, account, campagna, gruppo." });
      }

      const item = {
        id: body.id || `auto_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
        name: body.name.trim(),
        enabled: body.enabled ?? true,
        platform: body.platform,
        source_id: body.source_id,
        source_name: body.source_name || "",
        page_id: body.page_id || "",
        ad_account_id: body.ad_account_id,
        campaign_id: body.campaign_id,
        campaign_name: body.campaign_name || "",
        adset_id: body.adset_id,
        adset_name: body.adset_name || "",
        rule_id: body.rule_id || "",
        rule_name: body.rule_name || "",
        ad_name_pattern: body.ad_name_pattern || "ADV - {platform} - {post}",
        ad_status: body.ad_status || "PAUSED",
        check_interval_hours: Number(body.check_interval_hours) || 12,
        filter_keywords: body.filter_keywords || "",
        created_at: new Date().toISOString()
      };

      const saved = await db.saveAutomation(item);
      return json(res, 201, { ok: true, data: saved });
    }

    const autoMatch = url.pathname.match(/^\/api\/automations\/([a-zA-Z0-9_\-]+)(\/.*)?$/);
    if (autoMatch) {
      const autoId = autoMatch[1];
      const subAction = autoMatch[2];

      if (!subAction && req.method === "GET") {
        const item = await db.getAutomation(autoId);
        if (!item) return json(res, 404, { error: "Automazione non trovata" });
        return json(res, 200, { data: item });
      }

      if (!subAction && req.method === "PUT") {
        const body = await readJsonBody(req);
        const existing = await db.getAutomation(autoId);
        if (!existing) return json(res, 404, { error: "Automazione non trovata" });

        const updated = await db.saveAutomation({
          ...existing,
          ...body,
          id: autoId
        });
        return json(res, 200, { ok: true, data: updated });
      }

      if (!subAction && req.method === "DELETE") {
        await db.deleteAutomation(autoId);
        return json(res, 200, { ok: true });
      }

      if (subAction === "/toggle" && req.method === "POST") {
        const body = await readJsonBody(req);
        const item = await db.toggleAutomation(autoId, Boolean(body.enabled));
        return json(res, 200, { ok: true, data: item });
      }

      if (subAction === "/run" && req.method === "POST") {
        const report = await engine.runSingleAutomation(autoId, "MANUAL", true);
        return json(res, 200, { ok: true, report });
      }
    }

    if (url.pathname === "/api/automations/run-all" && req.method === "POST") {
      const result = await engine.runAllDueAutomations("MANUAL_RUN_ALL", true);
      return json(res, 200, { ok: true, result });
    }

    // -------------------------------------------------------------------------
    // LOGS & PROCESSED POSTS
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/logs" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 50);
      const logs = await db.getLogs(limit);
      return json(res, 200, { data: logs });
    }

    if (url.pathname === "/api/processed-posts" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 50);
      const posts = await db.getProcessedPosts(limit);
      return json(res, 200, { data: posts });
    }

    // -------------------------------------------------------------------------
    // META GRAPH API PROXIES (Manual Bulk Creation & Selectors)
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/meta/create-ads" && req.method === "POST") {
      const body = await readJsonBody(req);
      const results = [];

      for (const post of body.ads || []) {
        try {
          const creativeParams = {
            name: post.adName,
            status: "ACTIVE"
          };

          if (post.platform === "Facebook") {
            creativeParams.object_story_id = post.sourcePostId;
          } else {
            const page = metaService.pageForInstagramId(post.instagramAccountId);
            creativeParams.object_id = page?.id || post.pageId;
            creativeParams.instagram_user_id = post.instagramAccountId;
            creativeParams.source_instagram_media_id = post.sourcePostId;
          }

          const creative = await metaService.graphPost(`/${body.adAccountId}/adcreatives`, creativeParams);
          const ad = await metaService.graphPost(`/${body.adAccountId}/ads`, {
            name: post.adName,
            adset_id: post.adsetId,
            creative: { creative_id: creative.id },
            status: body.status || "PAUSED"
          });

          await db.recordProcessedPost({
            automation_id: null,
            platform: post.platform,
            source_id: post.platform === "Facebook" ? post.pageId : post.instagramAccountId,
            post_id: post.sourcePostId,
            post_permalink: post.permalink || "",
            post_message: post.adName,
            ad_id: ad.id,
            creative_id: creative.id,
            ad_name: post.adName,
            rule_applied: Boolean(post.ruleId),
            status: "SUCCESS"
          });

          results.push({
            ok: true,
            localId: post.id,
            adName: post.adName,
            platform: post.platform,
            adId: ad.id,
            creativeId: creative.id,
            ruleId: post.ruleId || null
          });
        } catch (error) {
          results.push({
            ok: false,
            localId: post.id,
            adName: post.adName,
            platform: post.platform,
            error: error.message,
            meta: error.meta || null
          });
        }
      }

      const createdByRule = results
        .filter((result) => result.ok && result.ruleId)
        .reduce((acc, result) => {
          acc[result.ruleId] ||= [];
          acc[result.ruleId].push(result.adId);
          return acc;
        }, {});

      for (const [ruleId, adIds] of Object.entries(createdByRule)) {
        try {
          const ruleResult = await metaService.applyRuleToCreatedAds(body.adAccountId, ruleId, adIds);
          results
            .filter((result) => result.ok && result.ruleId === ruleId)
            .forEach((result) => {
              result.ruleApplied = ruleResult.applied;
              result.ruleMessage = ruleResult.message;
            });
        } catch (error) {
          results
            .filter((result) => result.ok && result.ruleId === ruleId)
            .forEach((result) => {
              result.ruleApplied = false;
              result.ruleMessage = `Inserzione creata, ma regola non applicata: ${error.message}`;
              result.ruleMeta = error.meta || null;
            });
        }
      }

      return json(res, 200, { data: results });
    }

    if (url.pathname === "/api/meta/config") {
      let adAccounts = [];
      let adAccountsError = null;
      try {
        adAccounts = await metaService.listAdAccounts();
      } catch (error) {
        adAccountsError = error.message;
      }
      return json(res, 200, {
        apiVersion: metaService.apiVersion,
        loginConfigId: env.META_LOGIN_CONFIG_ID || null,
        ...metaService.configuredSources(),
        adAccounts,
        adAccountsError
      });
    }

    if (url.pathname === "/api/meta/sources") {
      const accountId = url.searchParams.get("accountId");
      return json(res, 200, await metaService.listSourcesForAdAccount(accountId));
    }

    if (url.pathname === "/api/meta/adaccounts") {
      return json(res, 200, { data: await metaService.listAdAccounts() });
    }

    if (url.pathname === "/api/meta/campaigns") {
      const accountId = url.searchParams.get("accountId");
      return json(res, 200, await metaService.listCampaigns(accountId));
    }

    if (url.pathname === "/api/meta/adsets") {
      const accountId = url.searchParams.get("accountId");
      const campaignId = url.searchParams.get("campaignId");
      return json(res, 200, await metaService.listAdsets(accountId, campaignId));
    }

    if (url.pathname === "/api/meta/rules") {
      const accountId = url.searchParams.get("accountId");
      return json(res, 200, await metaService.listRules(accountId));
    }

    if (url.pathname === "/api/meta/facebook-posts") {
      const pageId = url.searchParams.get("pageId");
      const limit = Number(url.searchParams.get("limit") || 50);
      return json(res, 200, await metaService.getFacebookPosts(pageId, limit));
    }

    if (url.pathname === "/api/meta/instagram-media") {
      const instagramId = url.searchParams.get("instagramId");
      const pageId = url.searchParams.get("pageId");
      const limit = Number(url.searchParams.get("limit") || 50);
      return json(res, 200, await metaService.getInstagramMedia(instagramId, pageId, limit));
    }

    return json(res, 404, { error: "Endpoint non trovato" });
  } catch (error) {
    console.error("[API Error]", error);
    return json(res, error.status || 500, {
      error: error.message,
      meta: error.meta || null
    });
  }
}

// -----------------------------------------------------------------------------
// OAUTH FLOW (Facebook Login)
// -----------------------------------------------------------------------------
async function handleOAuth(req, res, url) {
  const appId = env.META_APP_ID || "1487594375621582";
  const appSecret = env.META_APP_SECRET || "c5bdacb60e9268b584c504403eb452d1";
  const redirectUri = env.META_LOGIN_REDIRECT_URI || `http://${req.headers.host}/auth/callback`;

  if (url.pathname === "/auth/facebook") {
    const oauthUrl = new URL(`https://www.facebook.com/${metaService.apiVersion}/dialog/oauth`);
    oauthUrl.searchParams.set("client_id", appId);
    oauthUrl.searchParams.set("redirect_uri", redirectUri);
    oauthUrl.searchParams.set("scope", env.META_LOGIN_SCOPE || "ads_management,ads_read,business_management,pages_show_list,pages_read_engagement,instagram_basic");
    oauthUrl.searchParams.set("response_type", "code");
    res.writeHead(302, { Location: oauthUrl.toString() });
    res.end();
    return true;
  }

  if (url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (error || !code) {
      res.writeHead(302, { Location: `/?login_error=${encodeURIComponent(error || "Codice mancante")}` });
      res.end();
      return true;
    }

    try {
      const tokenUrl = new URL(`https://graph.facebook.com/${metaService.apiVersion}/oauth/access_token`);
      tokenUrl.searchParams.set("client_id", appId);
      tokenUrl.searchParams.set("client_secret", appSecret);
      tokenUrl.searchParams.set("redirect_uri", redirectUri);
      tokenUrl.searchParams.set("code", code);

      const tokenRes = await fetch(tokenUrl);
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok || tokenData.error) {
        throw new Error(tokenData.error?.message || "Impossibile scambiare il codice");
      }

      // Exchange short-lived token for 60-day Long-Lived Token
      let finalToken = tokenData.access_token;
      try {
        const exchangeUrl = new URL(`https://graph.facebook.com/${metaService.apiVersion}/oauth/access_token`);
        exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
        exchangeUrl.searchParams.set("client_id", appId);
        exchangeUrl.searchParams.set("client_secret", appSecret);
        exchangeUrl.searchParams.set("fb_exchange_token", tokenData.access_token);

        const exchangeRes = await fetch(exchangeUrl);
        const exchangeData = await exchangeRes.json();
        if (exchangeData.access_token) {
          finalToken = exchangeData.access_token;
          console.log("[Auth] Token esteso con successo a 60 giorni");
        }
      } catch (exErr) {
        console.warn("[Auth] Estensione token fallita, uso token standard:", exErr.message);
      }

      await db.setSetting("META_ACCESS_TOKEN", finalToken);
      metaService.updateConfig({ META_ACCESS_TOKEN: finalToken });
      console.log("[Auth] Nuovo token Meta memorizzato nel database!");

      res.writeHead(302, { Location: "/?login=ok" });
      res.end();
    } catch (authErr) {
      console.error("[Auth Error]", authErr);
      res.writeHead(302, { Location: `/?login_error=${encodeURIComponent(authErr.message)}` });
      res.end();
    }
    return true;
  }

  return false;
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, requestedPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/auth/")) {
    const handled = await handleOAuth(req, res, url);
    if (handled) return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }

  serveStatic(req, res, url);
});

async function start() {
  try {
    await db.initDb(env.DATABASE_URL);

    // If no access token in env, check DB
    if (!metaService.token()) {
      const savedToken = await db.getSetting("META_ACCESS_TOKEN");
      if (savedToken) {
        metaService.updateConfig({ META_ACCESS_TOKEN: savedToken });
        console.log("[Auth] Token Meta caricato dal database persistente");
      }
    }

    engine.startInternalScheduler();

    server.listen(PORT, () => {
      console.log(`AutoSponsorAds attivo su http://localhost:${PORT}`);
      console.log(`Cron Webhook disponibile su: http://localhost:${PORT}/api/cron/check-and-sponsor`);
    });
  } catch (err) {
    console.error("Errore critico durante l'avvio:", err);
    process.exit(1);
  }
}

start();
