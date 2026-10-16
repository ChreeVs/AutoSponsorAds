const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const MetaService = require("./metaService");
const AutomationEngine = require("./automationEngine");
const PubblieService = require("./pubblieService");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const env = { ...loadEnv(path.join(ROOT, ".env")), ...process.env };
const CRON_SECRET = env.CRON_SECRET || "";

const metaService = new MetaService(env);
const engine = new AutomationEngine(metaService);
const pubblieService = new PubblieService(env);

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

// -----------------------------------------------------------------------------
// Authentication & Session Security
// -----------------------------------------------------------------------------
const AUTH_SALT = "AutoSponsor_Salt_v2_";

function hashPassword(pwd) {
  return crypto.createHash("sha256").update(AUTH_SALT + pwd).digest("hex");
}

async function getMasterPasswordHash() {
  const envPwd = env.APP_PASSWORD || env.DASHBOARD_PASSWORD || "";
  if (envPwd && envPwd.trim()) {
    return hashPassword(envPwd.trim());
  }
  const dbHash = await db.getSetting("APP_PASSWORD_HASH");
  return dbHash || null;
}

function createSessionToken(passwordHash) {
  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${issuedAt}:${nonce}`;
  const sig = crypto.createHmac("sha256", passwordHash).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

function verifySessionToken(token, passwordHash) {
  if (!token || !passwordHash) return false;
  const parts = token.split(":");
  if (parts.length !== 3) return false;
  const [issuedAtStr, nonce, sig] = parts;
  const issuedAt = Number(issuedAtStr);
  if (!issuedAt || isNaN(issuedAt)) return false;

  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 giorni di persistenza
  const now = Date.now();
  if (now - issuedAt > MAX_AGE_MS) return false;
  if (issuedAt > now + 60000) return false; // Clock skew protection

  const expectedPayload = `${issuedAtStr}:${nonce}`;
  const expectedSig = crypto.createHmac("sha256", passwordHash).update(expectedPayload).digest("hex");

  try {
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(";").forEach(cookie => {
    const parts = cookie.split("=");
    const name = parts.shift().trim();
    if (name) list[name] = decodeURIComponent(parts.join("=").trim());
  });
  return list;
}

function getRequestSessionToken(req) {
  const cookies = parseCookies(req);
  if (cookies.autosponsor_session) return cookies.autosponsor_session;
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();
  if (req.headers["x-session-token"]) return req.headers["x-session-token"];
  return null;
}

async function isSessionAuthenticated(req) {
  const masterHash = await getMasterPasswordHash();
  if (!masterHash) return false;
  const token = getRequestSessionToken(req);
  if (!token) return false;
  return verifySessionToken(token, masterHash);
}

async function handleApi(req, res, url) {
  try {
    // -------------------------------------------------------------------------
    // CRON ENDPOINT (External cron bypasses session with CRON_SECRET)
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/cron/check-and-sponsor" && (req.method === "POST" || req.method === "GET")) {
      if (!checkCronAuth(req, url)) {
        return json(res, 401, { error: "Non autorizzato: token CRON_SECRET errato o mancante." });
      }
      // External cron runs all active automations by default (forceAll = true unless explicitly force=false)
      const forceAll = url.searchParams.get("force") !== "false";
      const result = await engine.runAllDueAutomations("EXTERNAL_CRON", forceAll);

      const verbose = url.searchParams.get("verbose") === "true";
      if (verbose) {
        return json(res, 200, { ok: true, timestamp: new Date().toISOString(), result });
      }

      // Compact lightweight response (<60 bytes) so external crons (cron-job.org) never fail with "output too large"
      return json(res, 200, {
        ok: true,
        executed: result.executedCount || 0,
        active: result.totalActive || 0
      });
    }

    // -------------------------------------------------------------------------
    // AUTHENTICATION & SESSION ENDPOINTS
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/auth/status" && req.method === "GET") {
      const masterHash = await getMasterPasswordHash();
      const setupRequired = !masterHash;
      const authenticated = setupRequired ? false : await isSessionAuthenticated(req);
      return json(res, 200, {
        ok: true,
        authenticated,
        setupRequired
      });
    }

    if (url.pathname === "/api/auth/setup" && req.method === "POST") {
      const currentMaster = await getMasterPasswordHash();
      if (currentMaster) {
        return json(res, 400, { ok: false, error: "La master password è già stata configurata." });
      }
      const body = await readJsonBody(req);
      const password = (body.password || "").trim();
      if (!password || password.length < 4) {
        return json(res, 400, { ok: false, error: "La password deve contenere almeno 4 caratteri." });
      }
      const newHash = hashPassword(password);
      await db.setSetting("APP_PASSWORD_HASH", newHash);
      const sessionToken = createSessionToken(newHash);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `autosponsor_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      });
      res.end(JSON.stringify({ ok: true, message: "Password configurata con successo!" }));
      return;
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const masterHash = await getMasterPasswordHash();
      if (!masterHash) {
        return json(res, 400, { ok: false, error: "Configurazione password richiesta." });
      }
      const body = await readJsonBody(req);
      const password = (body.password || "").trim();
      const inputHash = hashPassword(password);

      let isValid = false;
      try {
        isValid = crypto.timingSafeEqual(Buffer.from(inputHash, "hex"), Buffer.from(masterHash, "hex"));
      } catch {
        isValid = false;
      }

      if (!isValid) {
        return json(res, 401, { ok: false, error: "Password errata. Riprova." });
      }

      const sessionToken = createSessionToken(masterHash);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `autosponsor_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      });
      res.end(JSON.stringify({ ok: true, message: "Accesso autorizzato!" }));
      return;
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": "autosponsor_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
      });
      res.end(JSON.stringify({ ok: true, message: "Disconnessione effettuata." }));
      return;
    }

    if (url.pathname === "/api/auth/change-password" && req.method === "POST") {
      if (!await isSessionAuthenticated(req)) {
        return json(res, 401, { ok: false, error: "Non autorizzato" });
      }
      const body = await readJsonBody(req);
      const currentPassword = (body.currentPassword || "").trim();
      const newPassword = (body.newPassword || "").trim();

      if (!newPassword || newPassword.length < 4) {
        return json(res, 400, { ok: false, error: "La nuova password deve contenere almeno 4 caratteri." });
      }

      const masterHash = await getMasterPasswordHash();
      const inputHash = hashPassword(currentPassword);
      let isValid = false;
      try {
        isValid = crypto.timingSafeEqual(Buffer.from(inputHash, "hex"), Buffer.from(masterHash, "hex"));
      } catch {
        isValid = false;
      }

      if (!isValid) {
        return json(res, 400, { ok: false, error: "La password attuale non è corretta." });
      }

      const newHash = hashPassword(newPassword);
      await db.setSetting("APP_PASSWORD_HASH", newHash);
      const sessionToken = createSessionToken(newHash);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `autosponsor_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      });
      res.end(JSON.stringify({ ok: true, message: "Password aggiornata con successo!" }));
      return;
    }

    // -------------------------------------------------------------------------
    // GATEKEEPER: All remaining /api/* endpoints require authentication
    // -------------------------------------------------------------------------
    if (!await isSessionAuthenticated(req)) {
      return json(res, 401, {
        ok: false,
        error: "UNAUTHORIZED",
        message: "Accesso non autorizzato. Inserisci la master password per visualizzare i clienti e il pannello."
      });
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
        exclude_keywords: body.exclude_keywords || "",
        start_time: body.start_time || new Date().toISOString(),
        adset_full_strategy: body.adset_full_strategy || "ROTATE_OLDEST",
        adset_clone_source_id: body.adset_clone_source_id || "",
        adset_clone_name_pattern: body.adset_clone_name_pattern || "",
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

      if (subAction === "/duplicate" && req.method === "POST") {
        const existing = await db.getAutomation(autoId);
        if (!existing) return json(res, 404, { error: "Automazione non trovata" });

        const now = new Date().toISOString();
        const clone = {
          ...existing,
          id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: `${existing.name} (Copia)`,
          enabled: false,
          start_time: now,
          ad_status: existing.ad_status || "PAUSED",
          adset_full_strategy: existing.adset_full_strategy || "ROTATE_OLDEST",
          adset_clone_source_id: existing.adset_clone_source_id || "",
          adset_clone_name_pattern: existing.adset_clone_name_pattern || "",
          exclude_keywords: existing.exclude_keywords || "",
          created_at: now,
          last_checked_at: null,
          last_run_status: "IDLE",
          last_run_message: ""
        };

        const saved = await db.saveAutomation(clone);
        return json(res, 201, { ok: true, data: saved });
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
    // SETTINGS (Hidden / Archived Ad Accounts)
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/settings/hidden-accounts" && req.method === "GET") {
      const raw = await db.getSetting("hidden_ad_accounts");
      let hiddenAccounts = [];
      try { hiddenAccounts = raw ? JSON.parse(raw) : []; } catch {}
      return json(res, 200, { hiddenAccounts });
    }

    if (url.pathname === "/api/settings/hidden-accounts" && req.method === "POST") {
      const body = await readJsonBody(req);
      const hiddenAccounts = Array.isArray(body.hiddenAccounts) ? body.hiddenAccounts : [];
      await db.setSetting("hidden_ad_accounts", JSON.stringify(hiddenAccounts));
      return json(res, 200, { ok: true, hiddenAccounts });
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
      const rawHidden = await db.getSetting("hidden_ad_accounts");
      let hiddenAccounts = [];
      try { hiddenAccounts = rawHidden ? JSON.parse(rawHidden) : []; } catch {}

      return json(res, 200, {
        apiVersion: metaService.apiVersion,
        loginConfigId: env.META_LOGIN_CONFIG_ID || null,
        ...metaService.configuredSources(),
        adAccounts,
        adAccountsError,
        hiddenAccounts
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

    if (url.pathname === "/api/meta/adsets/clone" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.accountId || !body.adsetId) {
        return json(res, 400, { ok: false, error: "accountId e adsetId sono obbligatori" });
      }
      const cloned = await metaService.cloneAdset(body.accountId, body.adsetId, body.newName);
      return json(res, 200, { ok: true, data: cloned });
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

    // -------------------------------------------------------------------------
    // PUBBLIE INTEGRATION ENDPOINTS
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/pubblie/status" && req.method === "GET") {
      const key = pubblieService.getApiKey();
      let connection = null;
      if (key) {
        connection = await pubblieService.checkConnection(key);
      }
      return json(res, 200, {
        ok: true,
        configured: Boolean(key),
        keyPreview: key ? `${key.slice(0, 8)}...${key.slice(-4)}` : null,
        connection
      });
    }

    if (url.pathname === "/api/pubblie/save-key" && req.method === "POST") {
      const body = await readJsonBody(req);
      const cleanKey = (body.apiKey || "").trim();
      if (!cleanKey) return json(res, 400, { error: "Chiave API Pubblie non fornita" });

      const check = await pubblieService.checkConnection(cleanKey);
      if (!check.ok) {
        return json(res, 400, { error: `Verifica Pubblie fallita: ${check.error}` });
      }

      await db.setSetting("PUBBLIE_API_KEY", cleanKey);
      pubblieService.setApiKey(cleanKey);
      return json(res, 200, { ok: true, message: "Chiave API Pubblie salvata con successo!", user: check.user });
    }

    if (url.pathname === "/api/pubblie/disconnect" && req.method === "POST") {
      await db.setSetting("PUBBLIE_API_KEY", "");
      pubblieService.setApiKey("");
      return json(res, 200, { ok: true, message: "Collegamento Pubblie rimosso." });
    }

    if (url.pathname === "/api/pubblie/projects" && req.method === "GET") {
      const projects = await pubblieService.listProjects();
      return json(res, 200, { ok: true, data: projects });
    }

    const pubblieChannelsMatch = url.pathname.match(/^\/api\/pubblie\/projects\/([^\/]+)\/channels$/);
    if (pubblieChannelsMatch && req.method === "GET") {
      const projectId = pubblieChannelsMatch[1];
      const channels = await pubblieService.listProjectChannels(projectId);
      return json(res, 200, { ok: true, data: channels });
    }

    if (url.pathname === "/api/pubblie/mappings" && req.method === "GET") {
      const projectId = url.searchParams.get("projectId") || null;
      const mappings = await db.getPubblieMappings(projectId);
      return json(res, 200, { ok: true, data: mappings });
    }

    if (url.pathname === "/api/pubblie/mappings" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.project_id || !body.ad_account_id || !body.campaign_id || !body.adset_id) {
        return json(res, 400, { error: "Campi obbligatori mancanti: project_id, ad_account_id, campaign_id, adset_id." });
      }
      const saved = await db.savePubblieMapping(body);
      return json(res, 200, { ok: true, data: saved });
    }

    const pubblieMappingDeleteMatch = url.pathname.match(/^\/api\/pubblie\/mappings\/([^\/]+)$/);
    if (pubblieMappingDeleteMatch && req.method === "DELETE") {
      const id = pubblieMappingDeleteMatch[1];
      await db.deletePubblieMapping(id);
      return json(res, 200, { ok: true });
    }

    // -------------------------------------------------------------------------
    // TIMELINE FLOW & FORECAST ENDPOINTS
    // -------------------------------------------------------------------------
    if (url.pathname === "/api/timeline/feed" && req.method === "GET") {
      const filterProjectId = url.searchParams.get("projectId") || "";
      const filterChannelId = url.searchParams.get("channelId") || "";
      const filterPlatform = url.searchParams.get("platform") || "";
      const filterStatus = url.searchParams.get("status") || "";
      const daysAhead = Number(url.searchParams.get("days") || 30);

      const mappings = await db.getPubblieMappings();
      const decisions = await db.getTimelineDecisions();
      const processedPosts = await db.getProcessedPosts(100);

      const items = [];
      const now = new Date();
      const fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const toDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

      if (pubblieService.getApiKey()) {
        try {
          let projectIds = [];
          if (filterProjectId) {
            projectIds = [filterProjectId];
          } else if (mappings.length > 0) {
            projectIds = [...new Set(mappings.map(m => m.project_id))];
          } else {
            const userProjects = await pubblieService.listProjects();
            projectIds = userProjects.map(p => p.id).slice(0, 6);
          }

          for (const pId of projectIds) {
            try {
              const posts = await pubblieService.listProjectPosts(pId, { dateFrom: fromDate, dateTo: toDate });
              const mappedChannels = mappings.filter(m => m.project_id === pId);

              for (const p of posts) {
                let matchingMapping = null;
                if (p.channelIds && p.channelIds.length) {
                  matchingMapping = mappedChannels.find(m => p.channelIds.includes(m.channel_id));
                }
                if (!matchingMapping && mappedChannels.length) {
                  matchingMapping = mappedChannels[0];
                }

                let platform = "Instagram";
                if (matchingMapping) {
                  platform = matchingMapping.channel_provider?.toLowerCase().includes("face") ? "Facebook" : "Instagram";
                }

                const postDate = p.scheduleDateTime || p.publishedAt || now.toISOString();
                const isFuture = new Date(postDate).getTime() > now.getTime();

                let decision = decisions[p.id];
                let flowStatus = decision?.sponsorship_status;
                if (!flowStatus) {
                  flowStatus = matchingMapping ? (matchingMapping.auto_sponsor_on_publish ? "INCLUDED" : "EXCLUDED") : "INCLUDED";
                }

                const isAlreadyProcessed = processedPosts.find(pp => pp.post_id === p.id);
                if (isAlreadyProcessed || flowStatus === "SPONSORED") {
                  flowStatus = "SPONSORED";
                }

                items.push({
                  id: `pub_${p.id}`,
                  rawId: p.id,
                  source: "pubblie",
                  platform,
                  projectId: pId,
                  projectName: matchingMapping?.project_name || `Progetto ${pId}`,
                  channelIds: p.channelIds,
                  channelName: matchingMapping?.channel_name || "",
                  text: p.text || "",
                  images: p.images || [],
                  videoIds: p.videoIds || [],
                  link: p.link || "",
                  scheduledAt: p.scheduleDateTime,
                  publishedAt: p.publishedAt,
                  effectiveDate: postDate,
                  isFuture,
                  pubblieStatus: p.status,
                  flowStatus,
                  adId: isAlreadyProcessed?.ad_id || decision?.ad_id || "",
                  mapping: matchingMapping || null,
                  customTarget: decision?.custom_target || null
                });
              }
            } catch (pErr) {
              console.warn(`[Pubblie] Errore caricamento post per progetto ${pId}:`, pErr.message);
            }
          }
        } catch (pubErr) {
          console.warn("[Pubblie] Errore fetch post Pubblie:", pubErr.message);
        }
      }

      for (const pp of processedPosts) {
        if (!items.some(it => it.rawId === pp.post_id)) {
          items.push({
            id: `meta_${pp.post_id}`,
            rawId: pp.post_id,
            source: "meta",
            platform: pp.platform || "Instagram",
            projectId: "",
            projectName: "Meta Ads",
            channelIds: [pp.source_id],
            channelName: pp.source_id,
            text: pp.post_message || pp.ad_name || "",
            images: [],
            videoIds: [],
            link: pp.post_permalink || "",
            scheduledAt: null,
            publishedAt: pp.created_at,
            effectiveDate: pp.created_at,
            isFuture: false,
            pubblieStatus: "PUBLISHED",
            flowStatus: "SPONSORED",
            adId: pp.ad_id,
            mapping: null,
            customTarget: null
          });
        }
      }

      // Sort timeline strictly chronologically (upcoming earliest to latest)
      items.sort((a, b) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime());

      let filtered = items;
      if (filterPlatform) {
        filtered = filtered.filter(i => i.platform.toLowerCase() === filterPlatform.toLowerCase());
      }
      if (filterChannelId) {
        filtered = filtered.filter(i => (i.channelIds || []).includes(filterChannelId) || i.channelName === filterChannelId);
      }
      if (filterStatus) {
        if (filterStatus === "FUTURE") {
          filtered = filtered.filter(i => i.isFuture);
        } else {
          filtered = filtered.filter(i => i.flowStatus === filterStatus);
        }
      }

      const stats = {
        total: items.length,
        upcomingCount: items.filter(i => i.isFuture).length,
        includedCount: items.filter(i => i.flowStatus === "INCLUDED").length,
        excludedCount: items.filter(i => i.flowStatus === "EXCLUDED").length,
        sponsoredCount: items.filter(i => i.flowStatus === "SPONSORED").length,
        mappingsCount: mappings.length
      };

      return json(res, 200, {
        ok: true,
        data: filtered,
        stats,
        mappings
      });
    }

    if (url.pathname === "/api/timeline/decision" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.postId || !body.status) {
        return json(res, 400, { error: "postId e status ('INCLUDED' | 'EXCLUDED') sono obbligatori." });
      }

      const saved = await db.saveTimelineDecision(body.postId, {
        sponsorship_status: body.status,
        source: body.source || "pubblie",
        project_id: body.projectId || "",
        channel_id: body.channelId || "",
        custom_target: body.customTarget || null
      });

      return json(res, 200, { ok: true, data: saved });
    }

    if (url.pathname === "/api/timeline/bulk-decision" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!Array.isArray(body.postIds) || !body.status) {
        return json(res, 400, { error: "postIds (array) e status sono obbligatori." });
      }

      for (const id of body.postIds) {
        await db.saveTimelineDecision(id, { sponsorship_status: body.status });
      }

      return json(res, 200, { ok: true, count: body.postIds.length });
    }

    if (url.pathname === "/api/timeline/sponsor-now" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.adAccountId || !body.adsetId || !body.postId) {
        return json(res, 400, { error: "adAccountId, adsetId e postId sono obbligatori." });
      }

      const adName = body.adName || `ADV - ${body.platform || "Post"} - ${String(body.postId).slice(-6)}`;
      const creativeParams = {
        name: adName,
        status: "ACTIVE"
      };

      if (body.platform === "Facebook") {
        creativeParams.object_story_id = body.sourcePostId || body.postId;
      } else {
        const page = metaService.pageForInstagramId(body.instagramAccountId);
        creativeParams.object_id = page?.id || body.pageId;
        creativeParams.instagram_user_id = body.instagramAccountId;
        creativeParams.source_instagram_media_id = body.sourcePostId || body.postId;
      }

      const creative = await metaService.graphPost(`/${body.adAccountId}/adcreatives`, creativeParams);
      const ad = await metaService.graphPost(`/${body.adAccountId}/ads`, {
        name: adName,
        adset_id: body.adsetId,
        creative: { creative_id: creative.id },
        status: body.adStatus || "PAUSED"
      });

      if (body.ruleId) {
        try {
          await metaService.applyRuleToCreatedAds(body.adAccountId, body.ruleId, [ad.id]);
        } catch (rErr) {
          console.warn("[Timeline Sponsor] Errore applicazione regola:", rErr.message);
        }
      }

      await db.recordProcessedPost({
        automation_id: body.automationId || null,
        platform: body.platform || "Instagram",
        source_id: body.platform === "Facebook" ? body.pageId : body.instagramAccountId,
        post_id: body.postId,
        post_permalink: body.permalink || "",
        post_message: adName,
        ad_id: ad.id,
        creative_id: creative.id,
        ad_name: adName,
        rule_applied: Boolean(body.ruleId),
        status: "SUCCESS"
      });

      await db.saveTimelineDecision(body.postId, {
        sponsorship_status: "SPONSORED",
        ad_id: ad.id,
        notes: "Sponsorizzato manualmente dalla Timeline"
      });

      return json(res, 200, { ok: true, adId: ad.id, creativeId: creative.id });
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
    if (!await isSessionAuthenticated(req)) {
      res.writeHead(302, { Location: `/?login_error=${encodeURIComponent("Accesso non autorizzato. Sblocca prima il pannello con la password.")}` });
      res.end();
      return true;
    }
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
    if (!await isSessionAuthenticated(req)) {
      res.writeHead(302, { Location: `/?login_error=${encodeURIComponent("Accesso non autorizzato.")}` });
      res.end();
      return true;
    }
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

    // Check Pubblie API Key from DB
    if (!pubblieService.getApiKey()) {
      const savedPubblieKey = await db.getSetting("PUBBLIE_API_KEY");
      if (savedPubblieKey) {
        pubblieService.setApiKey(savedPubblieKey);
        console.log("[Pubblie] Chiave API Pubblie caricata dal database persistente");
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
