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

function applySecurityHeaders(res, req = null) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  const isHttps = req ? isHttpsRequest(req) : false;
  if (isHttps) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function json(res, statusCode, payload, req = null) {
  if (req) applySecurityHeaders(res, req);
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        const err = new Error("Dimensione richiesta eccessiva (massimo 2MB consentiti).");
        err.status = 413;
        req.destroy(err);
        return reject(err);
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw || !raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error("Formato JSON della richiesta non valido.");
        err.status = 400;
        reject(err);
      }
    });
    req.on("error", err => reject(err));
  });
}

function checkCronAuth(req, url = null) {
  if (!CRON_SECRET || typeof CRON_SECRET !== "string" || CRON_SECRET.trim().length === 0) {
    console.warn("[Security] Richiesta CRON rifiutata: CRON_SECRET non configurato.");
    return false;
  }
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  let token = match ? match[1].trim() : (req.headers["x-cron-secret"] || "").trim();

  // Supporta anche il passaggio del secret come parametro URL (?secret=, ?key=, ?token=) per massima compatibilita con cron-job.org
  if (!token && url && url.searchParams) {
    token = (url.searchParams.get("secret") || url.searchParams.get("key") || url.searchParams.get("token") || "").trim();
  }

  if (!token) return false;

  try {
    const bufA = Buffer.from(token);
    const bufB = Buffer.from(CRON_SECRET.trim());
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Authentication, Password Hashing & Session Security
// -----------------------------------------------------------------------------
const AUTH_SALT = "AutoSponsor_Salt_v2_";

// Rate limiter in-memory per proteggere il login da brute-force
const loginAttempts = new Map(); // ip -> { count, firstAttempt, blockedUntil }

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "127.0.0.1";
}

function checkLoginRateLimit(req, maxAttempts = 5, windowMs = 5 * 60 * 1000, lockMs = 10 * 60 * 1000) {
  const ip = getClientIp(req);
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now, blockedUntil: 0 };

  if (record.blockedUntil > now) {
    const waitSec = Math.ceil((record.blockedUntil - now) / 1000);
    return {
      allowed: false,
      ip,
      error: `Troppi tentativi falliti. Accesso bloccato per sicurezza. Riprova tra ${waitSec} secondi.`
    };
  }

  if (now - record.firstAttempt > windowMs) {
    record.count = 0;
    record.firstAttempt = now;
    record.blockedUntil = 0;
  }

  loginAttempts.set(ip, record);
  return { allowed: true, ip, record };
}

function recordFailedLogin(ip, maxAttempts = 5, lockMs = 10 * 60 * 1000) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now, blockedUntil: 0 };
  record.count += 1;
  if (record.count >= maxAttempts) {
    record.blockedUntil = now + lockMs;
  }
  loginAttempts.set(ip, record);
}

function resetLoginRateLimit(ip) {
  loginAttempts.delete(ip);
}

function isHttpsRequest(req) {
  return Boolean(req.socket && req.socket.encrypted) || req.headers["x-forwarded-proto"] === "https";
}

function getSessionCookieHeader(token, req, maxAge = 2592000) {
  const secureFlag = isHttpsRequest(req) ? "; Secure" : "";
  return `autosponsor_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
}

// PBKDF2 strong hashing con 100.000 iterazioni e salt randomico
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 100000;
  const hash = crypto.pbkdf2Sync(pwd, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2:${salt}:${iterations}:${hash}`;
}

function verifyPassword(pwd, storedHash) {
  if (!storedHash || !pwd) return false;
  try {
    if (storedHash.startsWith("pbkdf2:")) {
      const parts = storedHash.split(":");
      if (parts.length !== 4) return false;
      const [, salt, iterationsStr, expectedHash] = parts;
      const iterations = parseInt(iterationsStr, 10);
      if (isNaN(iterations) || iterations < 10000) return false;
      const actualHash = crypto.pbkdf2Sync(pwd, salt, iterations, 32, "sha256").toString("hex");
      const actualBuf = Buffer.from(actualHash, "hex");
      const expectedBuf = Buffer.from(expectedHash, "hex");
      if (actualBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(actualBuf, expectedBuf);
    }

    // Retrocompatibilità con i vecchi hash SHA-256
    const legacyHash = crypto.createHash("sha256").update(AUTH_SALT + pwd).digest("hex");
    const actualBuf = Buffer.from(legacyHash, "hex");
    const expectedBuf = Buffer.from(storedHash, "hex");
    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    return false;
  }
}

async function getMasterPasswordHash() {
  const envPwd = env.APP_PASSWORD || env.DASHBOARD_PASSWORD || "";
  if (envPwd && envPwd.trim()) {
    const trimmed = envPwd.trim();
    if (trimmed.startsWith("pbkdf2:") || trimmed.length === 64) {
      return trimmed;
    }
    // Per variabile d'ambiente plain-text usiamo hash deterministico
    return crypto.createHash("sha256").update(AUTH_SALT + trimmed).digest("hex");
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

  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 giorni
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
    if (url.pathname === "/api/cron/check-and-sponsor") {
      if (req.method !== "POST" && req.method !== "GET") {
        return json(res, 405, { error: "Metodo non consentito. Usa POST o GET." }, req);
      }
      if (!checkCronAuth(req, url)) {
        return json(res, 401, { error: "Non autorizzato: token CRON_SECRET errato, mancante o non configurato." }, req);
      }

      const forceAll = url.searchParams.get("force") !== "false";
      const isSync = url.searchParams.get("sync") === "true" || url.searchParams.get("wait") === "true";

      if (isSync) {
        const result = await engine.runAllDueAutomations("EXTERNAL_CRON", forceAll);
        const verbose = url.searchParams.get("verbose") === "true";
        if (verbose) {
          return json(res, 200, { ok: true, timestamp: new Date().toISOString(), result }, req);
        }
        return json(res, 200, {
          ok: true,
          executed: result.executedCount || 0,
          active: result.totalActive || 0
        }, req);
      }

      // Default ASYNC execution: respond immediately (<10ms) so external crons (cron-job.org) NEVER timeout!
      json(res, 200, {
        ok: true,
        status: "RUNNING",
        message: "Controllo automazioni avviato in background",
        timestamp: new Date().toISOString()
      }, req);

      // Execute in background
      engine.runAllDueAutomations("EXTERNAL_CRON", forceAll).catch(err => {
        console.error("[CRON] Errore esecuzione asincrona:", err.message);
      });
      return;
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
      }, req);
    }

    if (url.pathname === "/api/auth/setup" && req.method === "POST") {
      const currentMaster = await getMasterPasswordHash();
      if (currentMaster) {
        return json(res, 400, { ok: false, error: "La master password è già stata configurata." }, req);
      }
      const body = await readJsonBody(req);
      const password = (body.password || "").trim();
      if (!password || password.length < 8) {
        return json(res, 400, { ok: false, error: "La password deve contenere almeno 8 caratteri." }, req);
      }
      const newHash = hashPassword(password);
      await db.setSetting("APP_PASSWORD_HASH", newHash);
      const sessionToken = createSessionToken(newHash);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": getSessionCookieHeader(sessionToken, req)
      });
      res.end(JSON.stringify({ ok: true, message: "Password configurata con successo!" }));
      return;
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const rateCheck = checkLoginRateLimit(req);
      if (!rateCheck.allowed) {
        return json(res, 429, { ok: false, error: rateCheck.error }, req);
      }

      const masterHash = await getMasterPasswordHash();
      if (!masterHash) {
        return json(res, 400, { ok: false, error: "Configurazione password richiesta." }, req);
      }
      const body = await readJsonBody(req);
      const password = (body.password || "").trim();

      const isValid = verifyPassword(password, masterHash);

      if (!isValid) {
        recordFailedLogin(rateCheck.ip);
        return json(res, 401, { ok: false, error: "Password errata. Riprova." }, req);
      }

      // Success: reset fallimenti
      resetLoginRateLimit(rateCheck.ip);

      // Aggiornamento trasparente a PBKDF2 se l'hash memorizzato era nel vecchio formato
      if (!masterHash.startsWith("pbkdf2:") && !env.APP_PASSWORD) {
        const upgradedHash = hashPassword(password);
        await db.setSetting("APP_PASSWORD_HASH", upgradedHash);
      }

      const sessionToken = createSessionToken(masterHash);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": getSessionCookieHeader(sessionToken, req)
      });
      res.end(JSON.stringify({ ok: true, message: "Accesso autorizzato!" }));
      return;
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": getSessionCookieHeader("", req, 0)
      });
      res.end(JSON.stringify({ ok: true, message: "Disconnessione effettuata." }));
      return;
    }

    if (url.pathname === "/api/auth/change-password" && req.method === "POST") {
      if (!await isSessionAuthenticated(req)) {
        return json(res, 401, { ok: false, error: "Non autorizzato" }, req);
      }
      const body = await readJsonBody(req);
      const currentPassword = (body.currentPassword || "").trim();
      const newPassword = (body.newPassword || "").trim();

      if (!newPassword || newPassword.length < 8) {
        return json(res, 400, { ok: false, error: "La nuova password deve contenere almeno 8 caratteri." }, req);
      }

      const masterHash = await getMasterPasswordHash();
      const isValid = verifyPassword(currentPassword, masterHash);

      if (!isValid) {
        return json(res, 400, { ok: false, error: "La password attuale non è corretta." }, req);
      }

      const newHash = hashPassword(newPassword);
      await db.setSetting("APP_PASSWORD_HASH", newHash);
      const sessionToken = createSessionToken(newHash);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": getSessionCookieHeader(sessionToken, req)
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
      const scheduler = await engine.getNextCheckInfo();
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
        nodeVersion: process.version,
        scheduler
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
      const now = Date.now();
      const enriched = list.map(item => {
        const intervalMs = (item.check_interval_hours || 12) * 3600 * 1000;
        const lastCheck = item.last_checked_at ? new Date(item.last_checked_at).getTime() : 0;
        const nextCheckMs = lastCheck ? lastCheck + intervalMs : now;
        return {
          ...item,
          next_check_at: new Date(nextCheckMs).toISOString(),
          seconds_until_next_check: Math.max(0, Math.round((nextCheckMs - now) / 1000)),
          is_due: now >= nextCheckMs
        };
      });
      return json(res, 200, { data: enriched });
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
      const rawArchived = await db.getSetting("archived_pubblie_projects");
      let archivedProjectIds = [];
      try { archivedProjectIds = rawArchived ? JSON.parse(rawArchived) : []; } catch {}
      return json(res, 200, { ok: true, data: projects, archivedProjectIds });
    }

    if (url.pathname === "/api/pubblie/archived-projects" && req.method === "GET") {
      const raw = await db.getSetting("archived_pubblie_projects");
      let archivedProjectIds = [];
      try { archivedProjectIds = raw ? JSON.parse(raw) : []; } catch {}
      return json(res, 200, { ok: true, archivedProjectIds });
    }

    if (url.pathname === "/api/pubblie/archived-projects" && req.method === "POST") {
      const body = await readJsonBody(req);
      const archivedProjectIds = Array.isArray(body.archivedProjectIds) ? body.archivedProjectIds : [];
      await db.setSetting("archived_pubblie_projects", JSON.stringify(archivedProjectIds));
      return json(res, 200, { ok: true, archivedProjectIds });
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

      const rawArchived = await db.getSetting("archived_pubblie_projects");
      let archivedProjectIds = [];
      try { archivedProjectIds = rawArchived ? JSON.parse(rawArchived) : []; } catch {}

      const mappings = await db.getPubblieMappings();
      const decisions = await db.getTimelineDecisions();
      const processedPosts = await db.getProcessedPosts(100);

      let items = [];
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const fromDate = startOfToday.toISOString();
      const toDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

      if (pubblieService.getApiKey()) {
        try {
          const allUserProjects = await pubblieService.listProjects().catch(() => []);
          const projectMap = new Map(allUserProjects.map(p => [p.id, p]));

          let projectIds = [];
          if (filterProjectId) {
            projectIds = [filterProjectId];
          } else if (mappings.length > 0) {
            projectIds = [...new Set(mappings.map(m => m.project_id))].filter(id => !archivedProjectIds.includes(id));
          } else {
            projectIds = allUserProjects
              .map(p => p.id)
              .filter(id => !archivedProjectIds.includes(id))
              .slice(0, 10);
          }

          for (const pId of projectIds) {
            try {
              const [posts, projectChannels] = await Promise.all([
                pubblieService.listProjectPosts(pId, { dateFrom: fromDate, dateTo: toDate }),
                pubblieService.listProjectChannels(pId).catch(() => [])
              ]);
              const mappedChannels = mappings.filter(m => m.project_id === pId);
              const projectObj = projectMap.get(pId);
              const projectNameFallback = projectObj ? `${projectObj.name}${projectObj.teamName ? ` (${projectObj.teamName})` : ""}` : `Progetto ${pId}`;

              for (const p of posts) {
                // Enrich accounts with project channel info
                const enrichedAccounts = (p.accounts || []).map(acc => {
                  const prov = (acc.provider || "").toLowerCase().trim();
                  const ch = (projectChannels || []).find(c =>
                    (acc.accountName && c.name && c.name.toLowerCase() === acc.accountName.toLowerCase()) ||
                    (prov && c.provider && c.provider.toLowerCase() === prov && acc.accountName && c.accountUsername && c.accountUsername.toLowerCase() === acc.accountName.toLowerCase()) ||
                    (acc.channelId && c.id === acc.channelId)
                  );
                  return {
                    provider: ch?.provider || prov,
                    accountName: ch?.name || acc.accountName || "",
                    channelId: ch ? ch.id : (acc.channelId || "")
                  };
                });

                const postProviders = enrichedAccounts.map(a => (a.provider || "").toLowerCase());
                const postChannelIds = enrichedAccounts.map(a => a.channelId).filter(Boolean);
                const hasFacebook = postProviders.some(pr => pr.includes("face"));
                const hasInstagram = postProviders.some(pr => pr.includes("insta"));
                const isMetaCompatible = hasFacebook || hasInstagram || (postProviders.length === 0 && Boolean(mappedChannels.length));

                let matchingMapping = null;
                if (isMetaCompatible) {
                  if (postChannelIds.length) {
                    matchingMapping = mappedChannels.find(m => postChannelIds.includes(m.channel_id));
                  }
                  if (!matchingMapping && hasFacebook) {
                    matchingMapping = mappedChannels.find(m => m.channel_provider?.toLowerCase().includes("face"));
                  }
                  if (!matchingMapping && hasInstagram) {
                    matchingMapping = mappedChannels.find(m => m.channel_provider?.toLowerCase().includes("insta"));
                  }
                  if (!matchingMapping && mappedChannels.length === 1) {
                    matchingMapping = mappedChannels[0];
                  }
                }

                let platform = "Instagram";
                let primaryProvider = "instagram";
                if (isMetaCompatible) {
                  if (hasFacebook && hasInstagram) {
                    platform = "Meta (FB+IG)";
                    primaryProvider = "facebook";
                  } else if (hasFacebook) {
                    platform = "Facebook";
                    primaryProvider = "facebook";
                  } else {
                    platform = "Instagram";
                    primaryProvider = "instagram";
                  }
                } else {
                  primaryProvider = postProviders[0] || "other";
                  if (primaryProvider.includes("tiktok")) platform = "TikTok";
                  else if (primaryProvider.includes("link")) platform = "LinkedIn";
                  else if (primaryProvider.includes("google") || primaryProvider.includes("business")) platform = "Google Business";
                  else if (primaryProvider.includes("twit") || primaryProvider === "x") platform = "X (Twitter)";
                  else platform = primaryProvider ? primaryProvider.charAt(0).toUpperCase() + primaryProvider.slice(1) : "Social Esterno";
                }

                const postDate = p.scheduleDateTime || p.publishedAt || now.toISOString();
                const isFuture = new Date(postDate).getTime() > now.getTime();

                let decision = decisions[p.id];
                let flowStatus = decision?.sponsorship_status;
                if (!flowStatus) {
                  if (isMetaCompatible) {
                    flowStatus = matchingMapping ? (matchingMapping.auto_sponsor_on_publish ? "INCLUDED" : "EXCLUDED") : "INCLUDED";
                  } else {
                    flowStatus = "EXTERNAL";
                  }
                }

                const isAlreadyProcessed = processedPosts.find(pp => pp.post_id === p.id);
                if (isAlreadyProcessed || flowStatus === "SPONSORED") {
                  flowStatus = "SPONSORED";
                }

                const channelName = matchingMapping?.channel_name ||
                  enrichedAccounts.find(a => a.accountName)?.accountName ||
                  p.channelIds?.[0] || "";

                items.push({
                  id: `pub_${p.id}`,
                  rawId: p.id,
                  source: "pubblie",
                  platform,
                  primaryProvider,
                  providers: postProviders,
                  isMetaCompatible,
                  projectId: pId,
                  projectName: matchingMapping?.project_name || projectNameFallback,
                  channelIds: postChannelIds.length ? postChannelIds : p.channelIds,
                  channelName,
                  accounts: enrichedAccounts,
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

      // Strictly only today (from 00:00:00) and future posts
      const todayTimestamp = startOfToday.getTime();
      items = items.filter(it => {
        const t = new Date(it.effectiveDate).getTime();
        return !isNaN(t) && t >= todayTimestamp;
      });

      // Sort timeline strictly chronologically (upcoming earliest to latest)
      items.sort((a, b) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime());

      let filtered = items;
      if (filterPlatform && filterPlatform !== "all") {
        if (filterPlatform === "meta") {
          filtered = filtered.filter(i => i.isMetaCompatible);
        } else if (filterPlatform === "other") {
          filtered = filtered.filter(i => !i.isMetaCompatible);
        } else if (filterPlatform.toLowerCase() === "facebook") {
          filtered = filtered.filter(i => (i.providers || []).some(p => p.includes("face")) || i.platform.toLowerCase() === "facebook");
        } else if (filterPlatform.toLowerCase() === "instagram") {
          filtered = filtered.filter(i => (i.providers || []).some(p => p.includes("insta")) || i.platform.toLowerCase() === "instagram");
        } else {
          filtered = filtered.filter(i => i.platform.toLowerCase() === filterPlatform.toLowerCase());
        }
      } else if (!filterPlatform) {
        // Default to Meta-compatible posts only, to avoid cluttering the flow with LinkedIn/TikTok/GMB posts
        filtered = filtered.filter(i => i.isMetaCompatible);
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
        total: filtered.length,
        upcomingCount: filtered.filter(i => i.isFuture).length,
        includedCount: filtered.filter(i => i.flowStatus === "INCLUDED").length,
        excludedCount: filtered.filter(i => i.flowStatus === "EXCLUDED").length,
        sponsoredCount: filtered.filter(i => i.flowStatus === "SPONSORED").length,
        externalCount: filtered.filter(i => !i.isMetaCompatible).length,
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
        custom_target: body.customTarget || null,
        post_text: body.postText || body.post_text || "",
        post_permalink: body.postPermalink || body.post_permalink || ""
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
  const appId = (env.META_APP_ID || "").trim();
  const appSecret = (env.META_APP_SECRET || "").trim();
  const redirectUri = env.META_LOGIN_REDIRECT_URI || `http://${req.headers.host}/auth/callback`;

  if (!appId || !appSecret) {
    if (url.pathname.startsWith("/auth/")) {
      res.writeHead(302, {
        Location: `/?login_error=${encodeURIComponent("Credenziali Meta non configurate: imposta META_APP_ID e META_APP_SECRET nel file .env o nelle variabili d'ambiente.")}`
      });
      res.end();
      return true;
    }
    return false;
  }

  const secureFlag = isHttpsRequest(req) ? "; Secure" : "";

  if (url.pathname === "/auth/facebook") {
    if (!await isSessionAuthenticated(req)) {
      res.writeHead(302, { Location: `/?login_error=${encodeURIComponent("Accesso non autorizzato. Sblocca prima il pannello con la password.")}` });
      res.end();
      return true;
    }

    // Protezione CSRF: generazione e salvataggio dello stato OAuth in cookie HttpOnly
    const state = crypto.randomBytes(24).toString("hex");
    const oauthUrl = new URL(`https://www.facebook.com/${metaService.apiVersion}/dialog/oauth`);
    oauthUrl.searchParams.set("client_id", appId);
    oauthUrl.searchParams.set("redirect_uri", redirectUri);
    oauthUrl.searchParams.set("state", state);
    oauthUrl.searchParams.set("scope", env.META_LOGIN_SCOPE || "ads_management,ads_read,business_management,pages_show_list,pages_read_engagement,instagram_basic");
    oauthUrl.searchParams.set("response_type", "code");

    res.writeHead(302, {
      Location: oauthUrl.toString(),
      "Set-Cookie": `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secureFlag}`
    });
    res.end();
    return true;
  }

  if (url.pathname === "/auth/callback") {
    if (!await isSessionAuthenticated(req)) {
      res.writeHead(302, { Location: `/?login_error=${encodeURIComponent("Accesso non autorizzato.")}` });
      res.end();
      return true;
    }

    const cookies = parseCookies(req);
    const expectedState = cookies.oauth_state;
    const returnedState = url.searchParams.get("state");
    const clearStateCookie = `oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;

    if (!expectedState || !returnedState || expectedState !== returnedState) {
      res.writeHead(302, {
        Location: `/?login_error=${encodeURIComponent("Verifica di sicurezza OAuth CSRF fallita: sessione non valida o scaduta. Riprova.")}`,
        "Set-Cookie": clearStateCookie
      });
      res.end();
      return true;
    }

    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (error || !code) {
      res.writeHead(302, {
        Location: `/?login_error=${encodeURIComponent(error || "Codice autorizzazione mancante")}`,
        "Set-Cookie": clearStateCookie
      });
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
        throw new Error(tokenData.error?.message || "Impossibile scambiare il codice di autorizzazione con Meta");
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

      res.writeHead(302, {
        Location: "/?login=ok",
        "Set-Cookie": clearStateCookie
      });
      res.end();
    } catch (authErr) {
      console.error("[Auth Error]", authErr);
      res.writeHead(302, {
        Location: `/?login_error=${encodeURIComponent(authErr.message)}`,
        "Set-Cookie": clearStateCookie
      });
      res.end();
    }
    return true;
  }

  return false;
}

// Whitelist rigorosa di risorse pubbliche accessibili dal browser
const PUBLIC_FILE_WHITELIST = new Set([
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/favicon.ico"
]);

function serveStatic(req, res, url) {
  applySecurityHeaders(res, req);

  // Consentiti esclusivamente metodi di lettura GET e HEAD
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Metodo non consentito");
    return;
  }

  const pathname = url.pathname;

  // Protezione anti-traversal e blocco file nascosti (.env, .git, ecc.)
  if (pathname.includes("\0") || pathname.includes("..") || pathname.split("/").some(part => part.startsWith("."))) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Accesso negato");
    return;
  }

  let relativePath = null;
  if (PUBLIC_FILE_WHITELIST.has(pathname)) {
    relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  } else if (pathname.startsWith("/assets/")) {
    const filename = path.basename(pathname);
    // Solo caratteri alfanumerici e trattini consentiti per gli asset statici
    if (/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
      relativePath = path.join("assets", filename);
    }
  }

  if (!relativePath) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Risorsa non trovata");
    return;
  }

  const filePath = path.normalize(path.join(ROOT, relativePath));

  // Controllo perimetrale sandbox ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Accesso negato");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Risorsa non trovata");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    // Blocco categorico aggiuntivo per estensioni riservate al server
    const forbiddenExts = [".env", ".db", ".json", ".yaml", ".yml", ".md", ".lock", ".sh", ".ps1"];
    if (forbiddenExts.includes(ext) || (ext === ".js" && relativePath !== "app.js")) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("Accesso negato");
      return;
    }

    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res, req);
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

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
