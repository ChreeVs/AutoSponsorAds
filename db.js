const path = require("path");
const fs = require("fs");

let pgPool = null;
let sqliteDb = null;
let dbType = "none";

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const JSON_STORE_PATH = path.join(DATA_DIR, "autosponsor_store.json");

let jsonState = {
  automations: [],
  processed_posts: [],
  execution_logs: [],
  app_settings: {}
};

function loadJsonStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(JSON_STORE_PATH)) {
      const raw = fs.readFileSync(JSON_STORE_PATH, "utf8");
      jsonState = { ...jsonState, ...JSON.parse(raw) };
    } else {
      saveJsonStore();
    }
  } catch (err) {
    console.warn("[DB] Errore caricamento store JSON:", err.message);
  }
}

function saveJsonStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(JSON_STORE_PATH, JSON.stringify(jsonState, null, 2), "utf8");
  } catch (err) {
    console.error("[DB] Errore salvataggio store JSON:", err.message);
  }
}

async function initDb(databaseUrl) {
  // 1. Try PostgreSQL cloud (Neon / Supabase / Render Postgres)
  if (databaseUrl && (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://"))) {
    try {
      const { Pool } = require("pg");
      pgPool = new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false }
      });
      await pgPool.query("SELECT 1");
      dbType = "postgres";
      console.log("[DB] Connesso con successo a PostgreSQL cloud");
      await setupPostgresSchema();
      return;
    } catch (err) {
      console.error("[DB] Connessione PostgreSQL fallita, provo storage locale:", err.message);
      pgPool = null;
    }
  }

  // 2. Try native node:sqlite (Node 22+)
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const { DatabaseSync } = require("node:sqlite");
    const dbPath = path.join(DATA_DIR, "autosponsor.db");
    sqliteDb = new DatabaseSync(dbPath);
    sqliteDb.exec("PRAGMA journal_mode = WAL;");
    dbType = "sqlite";
    console.log(`[DB] Connesso a SQLite locale (${dbPath})`);
    setupSqliteSchema();
    return;
  } catch (err) {
    console.log(`[DB] node:sqlite non disponibile in questo ambiente (${err.message}). Attivazione JSON Storage universale.`);
  }

  // 3. Universal JSON file storage (works on ALL Node versions: 18, 20, 22, 24)
  dbType = "json";
  loadJsonStore();
  console.log(`[DB] Connesso a JSON Storage locale (${JSON_STORE_PATH})`);
}

async function setupPostgresSchema() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS automations (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      enabled BOOLEAN DEFAULT true,
      platform VARCHAR(32) NOT NULL,
      source_id VARCHAR(128) NOT NULL,
      source_name VARCHAR(255) DEFAULT '',
      page_id VARCHAR(128) DEFAULT '',
      ad_account_id VARCHAR(128) NOT NULL,
      campaign_id VARCHAR(128) NOT NULL,
      campaign_name VARCHAR(255) DEFAULT '',
      adset_id VARCHAR(128) NOT NULL,
      adset_name VARCHAR(255) DEFAULT '',
      rule_id VARCHAR(128) DEFAULT '',
      rule_name VARCHAR(255) DEFAULT '',
      ad_name_pattern VARCHAR(255) DEFAULT 'ADV - {platform} - {post}',
      ad_status VARCHAR(32) DEFAULT 'PAUSED',
      check_interval_hours INTEGER DEFAULT 12,
      filter_keywords VARCHAR(255) DEFAULT '',
      exclude_keywords VARCHAR(255) DEFAULT '',
      start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      adset_full_strategy VARCHAR(64) DEFAULT 'ROTATE_OLDEST',
      adset_clone_source_id VARCHAR(128) DEFAULT '',
      adset_clone_name_pattern VARCHAR(255) DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      last_checked_at TIMESTAMP WITH TIME ZONE,
      last_run_status VARCHAR(32) DEFAULT 'IDLE',
      last_run_message TEXT DEFAULT ''
    );

    ALTER TABLE automations ADD COLUMN IF NOT EXISTS start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE automations ADD COLUMN IF NOT EXISTS adset_full_strategy VARCHAR(64) DEFAULT 'ROTATE_OLDEST';
    ALTER TABLE automations ADD COLUMN IF NOT EXISTS adset_clone_source_id VARCHAR(128) DEFAULT '';
    ALTER TABLE automations ADD COLUMN IF NOT EXISTS adset_clone_name_pattern VARCHAR(255) DEFAULT '';
    ALTER TABLE automations ADD COLUMN IF NOT EXISTS exclude_keywords VARCHAR(255) DEFAULT '';

    CREATE TABLE IF NOT EXISTS processed_posts (
      id SERIAL PRIMARY KEY,
      automation_id VARCHAR(64) REFERENCES automations(id) ON DELETE CASCADE,
      platform VARCHAR(32) NOT NULL,
      source_id VARCHAR(128) NOT NULL,
      post_id VARCHAR(128) NOT NULL UNIQUE,
      post_permalink TEXT DEFAULT '',
      post_message TEXT DEFAULT '',
      ad_id VARCHAR(128) DEFAULT '',
      creative_id VARCHAR(128) DEFAULT '',
      ad_name VARCHAR(255) DEFAULT '',
      rule_applied BOOLEAN DEFAULT false,
      status VARCHAR(32) DEFAULT 'SUCCESS',
      error_message TEXT DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS execution_logs (
      id SERIAL PRIMARY KEY,
      automation_id VARCHAR(64) DEFAULT '',
      automation_name VARCHAR(255) DEFAULT '',
      trigger_type VARCHAR(32) DEFAULT 'CRON',
      posts_found INTEGER DEFAULT 0,
      ads_created INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      details TEXT DEFAULT '',
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(128) PRIMARY KEY,
      value TEXT
    );
  `);
}

function setupSqliteSchema() {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      platform TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_name TEXT DEFAULT '',
      page_id TEXT DEFAULT '',
      ad_account_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT DEFAULT '',
      adset_id TEXT NOT NULL,
      adset_name TEXT DEFAULT '',
      rule_id TEXT DEFAULT '',
      rule_name TEXT DEFAULT '',
      ad_name_pattern TEXT DEFAULT 'ADV - {platform} - {post}',
      ad_status TEXT DEFAULT 'PAUSED',
      check_interval_hours INTEGER DEFAULT 12,
      filter_keywords TEXT DEFAULT '',
      exclude_keywords TEXT DEFAULT '',
      start_time TEXT,
      adset_full_strategy TEXT DEFAULT 'ROTATE_OLDEST',
      adset_clone_source_id TEXT DEFAULT '',
      adset_clone_name_pattern TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      last_checked_at TEXT,
      last_run_status TEXT DEFAULT 'IDLE',
      last_run_message TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS processed_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id TEXT,
      platform TEXT NOT NULL,
      source_id TEXT NOT NULL,
      post_id TEXT NOT NULL UNIQUE,
      post_permalink TEXT DEFAULT '',
      post_message TEXT DEFAULT '',
      ad_id TEXT DEFAULT '',
      creative_id TEXT DEFAULT '',
      ad_name TEXT DEFAULT '',
      rule_applied INTEGER DEFAULT 0,
      status TEXT DEFAULT 'SUCCESS',
      error_message TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id TEXT DEFAULT '',
      automation_name TEXT DEFAULT '',
      trigger_type TEXT DEFAULT 'CRON',
      posts_found INTEGER DEFAULT 0,
      ads_created INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      details TEXT DEFAULT '',
      executed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN start_time TEXT;"); } catch {}
  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN adset_full_strategy TEXT DEFAULT 'ROTATE_OLDEST';"); } catch {}
  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN adset_clone_source_id TEXT DEFAULT '';"); } catch {}
  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN adset_clone_name_pattern TEXT DEFAULT '';"); } catch {}
  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN exclude_keywords TEXT DEFAULT '';"); } catch {}
}

// -----------------------------------------------------------------------------
// Unified CRUD API
// -----------------------------------------------------------------------------

async function getAutomations() {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM automations ORDER BY created_at DESC");
    return res.rows.map(row => ({ ...row, enabled: Boolean(row.enabled) }));
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("SELECT * FROM automations ORDER BY created_at DESC");
    return stmt.all().map(row => ({ ...row, enabled: Boolean(row.enabled) }));
  }
  return [...jsonState.automations].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function getAutomation(id) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM automations WHERE id = $1", [id]);
    if (!res.rows.length) return null;
    return { ...res.rows[0], enabled: Boolean(res.rows[0].enabled) };
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("SELECT * FROM automations WHERE id = ?");
    const row = stmt.get(id);
    if (!row) return null;
    return { ...row, enabled: Boolean(row.enabled) };
  }
  return jsonState.automations.find(a => a.id === id) || null;
}

async function saveAutomation(item) {
  const now = new Date().toISOString();
  const normalized = {
    ...item,
    enabled: item.enabled ?? true,
    start_time: item.start_time || item.created_at || now,
    adset_full_strategy: item.adset_full_strategy || "ROTATE_OLDEST",
    adset_clone_source_id: item.adset_clone_source_id || "",
    adset_clone_name_pattern: item.adset_clone_name_pattern || "",
    exclude_keywords: item.exclude_keywords || "",
    created_at: item.created_at || now,
    last_run_status: item.last_run_status || "IDLE",
    last_run_message: item.last_run_message || ""
  };

  if (dbType === "postgres") {
    await pgPool.query(`
      INSERT INTO automations (
        id, name, enabled, platform, source_id, source_name, page_id,
        ad_account_id, campaign_id, campaign_name, adset_id, adset_name,
        rule_id, rule_name, ad_name_pattern, ad_status, check_interval_hours,
        filter_keywords, exclude_keywords, start_time, adset_full_strategy, adset_clone_source_id, adset_clone_name_pattern,
        created_at, last_checked_at, last_run_status, last_run_message
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        enabled = EXCLUDED.enabled,
        platform = EXCLUDED.platform,
        source_id = EXCLUDED.source_id,
        source_name = EXCLUDED.source_name,
        page_id = EXCLUDED.page_id,
        ad_account_id = EXCLUDED.ad_account_id,
        campaign_id = EXCLUDED.campaign_id,
        campaign_name = EXCLUDED.campaign_name,
        adset_id = EXCLUDED.adset_id,
        adset_name = EXCLUDED.adset_name,
        rule_id = EXCLUDED.rule_id,
        rule_name = EXCLUDED.rule_name,
        ad_name_pattern = EXCLUDED.ad_name_pattern,
        ad_status = EXCLUDED.ad_status,
        check_interval_hours = EXCLUDED.check_interval_hours,
        filter_keywords = EXCLUDED.filter_keywords,
        exclude_keywords = EXCLUDED.exclude_keywords,
        start_time = EXCLUDED.start_time,
        adset_full_strategy = EXCLUDED.adset_full_strategy,
        adset_clone_source_id = EXCLUDED.adset_clone_source_id,
        adset_clone_name_pattern = EXCLUDED.adset_clone_name_pattern
    `, [
      normalized.id, normalized.name, normalized.enabled, normalized.platform, normalized.source_id,
      normalized.source_name || "", normalized.page_id || "", normalized.ad_account_id,
      normalized.campaign_id, normalized.campaign_name || "", normalized.adset_id, normalized.adset_name || "",
      normalized.rule_id || "", normalized.rule_name || "", normalized.ad_name_pattern || "ADV - {platform} - {post}",
      normalized.ad_status || "PAUSED", normalized.check_interval_hours || 12, normalized.filter_keywords || "",
      normalized.exclude_keywords,
      normalized.start_time, normalized.adset_full_strategy, normalized.adset_clone_source_id, normalized.adset_clone_name_pattern,
      normalized.created_at, normalized.last_checked_at || null,
      normalized.last_run_status, normalized.last_run_message
    ]);
    return getAutomation(normalized.id);
  }

  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare(`
      INSERT INTO automations (
        id, name, enabled, platform, source_id, source_name, page_id,
        ad_account_id, campaign_id, campaign_name, adset_id, adset_name,
        rule_id, rule_name, ad_name_pattern, ad_status, check_interval_hours,
        filter_keywords, exclude_keywords, start_time, adset_full_strategy, adset_clone_source_id, adset_clone_name_pattern,
        created_at, last_checked_at, last_run_status, last_run_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        platform = excluded.platform,
        source_id = excluded.source_id,
        source_name = excluded.source_name,
        page_id = excluded.page_id,
        ad_account_id = excluded.ad_account_id,
        campaign_id = excluded.campaign_id,
        campaign_name = excluded.campaign_name,
        adset_id = excluded.adset_id,
        adset_name = excluded.adset_name,
        rule_id = excluded.rule_id,
        rule_name = excluded.rule_name,
        ad_name_pattern = excluded.ad_name_pattern,
        ad_status = excluded.ad_status,
        check_interval_hours = excluded.check_interval_hours,
        filter_keywords = excluded.filter_keywords,
        exclude_keywords = excluded.exclude_keywords,
        start_time = excluded.start_time,
        adset_full_strategy = excluded.adset_full_strategy,
        adset_clone_source_id = excluded.adset_clone_source_id,
        adset_clone_name_pattern = excluded.adset_clone_name_pattern
    `);

    stmt.run(
      normalized.id, normalized.name, normalized.enabled ? 1 : 0, normalized.platform, normalized.source_id,
      normalized.source_name || "", normalized.page_id || "", normalized.ad_account_id,
      normalized.campaign_id, normalized.campaign_name || "", normalized.adset_id, normalized.adset_name || "",
      normalized.rule_id || "", normalized.rule_name || "", normalized.ad_name_pattern || "ADV - {platform} - {post}",
      normalized.ad_status || "PAUSED", normalized.check_interval_hours || 12, normalized.filter_keywords || "",
      normalized.exclude_keywords,
      normalized.start_time, normalized.adset_full_strategy, normalized.adset_clone_source_id, normalized.adset_clone_name_pattern,
      normalized.created_at, normalized.last_checked_at || null,
      normalized.last_run_status, normalized.last_run_message
    );

    return getAutomation(normalized.id);
  }

  // JSON store
  const existingIdx = jsonState.automations.findIndex(a => a.id === normalized.id);
  if (existingIdx >= 0) {
    jsonState.automations[existingIdx] = { ...jsonState.automations[existingIdx], ...normalized };
  } else {
    jsonState.automations.push(normalized);
  }
  saveJsonStore();
  return normalized;
}

async function deleteAutomation(id) {
  if (dbType === "postgres") {
    await pgPool.query("DELETE FROM automations WHERE id = $1", [id]);
    return true;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("DELETE FROM automations WHERE id = ?");
    stmt.run(id);
    return true;
  }
  jsonState.automations = jsonState.automations.filter(a => a.id !== id);
  saveJsonStore();
  return true;
}

async function toggleAutomation(id, enabled) {
  if (dbType === "postgres") {
    await pgPool.query("UPDATE automations SET enabled = $1 WHERE id = $2", [enabled, id]);
    return getAutomation(id);
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("UPDATE automations SET enabled = ? WHERE id = ?");
    stmt.run(enabled ? 1 : 0, id);
    return getAutomation(id);
  }
  const item = jsonState.automations.find(a => a.id === id);
  if (item) {
    item.enabled = Boolean(enabled);
    saveJsonStore();
  }
  return item;
}

async function updateAutomationCheckResult(id, status, message) {
  const now = new Date().toISOString();
  if (dbType === "postgres") {
    await pgPool.query(
      "UPDATE automations SET last_checked_at = $1, last_run_status = $2, last_run_message = $3 WHERE id = $4",
      [now, status, message, id]
    );
    return;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare(
      "UPDATE automations SET last_checked_at = ?, last_run_status = ?, last_run_message = ? WHERE id = ?"
    );
    stmt.run(now, status, message, id);
    return;
  }
  const item = jsonState.automations.find(a => a.id === id);
  if (item) {
    item.last_checked_at = now;
    item.last_run_status = status;
    item.last_run_message = message;
    saveJsonStore();
  }
}

async function isPostProcessed(postId) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT 1 FROM processed_posts WHERE post_id = $1", [postId]);
    return res.rows.length > 0;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("SELECT 1 FROM processed_posts WHERE post_id = ?");
    return Boolean(stmt.get(postId));
  }
  return jsonState.processed_posts.some(p => p.post_id === postId);
}

async function recordProcessedPost(data) {
  const now = new Date().toISOString();
  if (dbType === "postgres") {
    await pgPool.query(`
      INSERT INTO processed_posts (
        automation_id, platform, source_id, post_id, post_permalink,
        post_message, ad_id, creative_id, ad_name, rule_applied, status, error_message, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (post_id) DO NOTHING
    `, [
      data.automation_id, data.platform, data.source_id, data.post_id,
      data.post_permalink || "", data.post_message || "", data.ad_id || "",
      data.creative_id || "", data.ad_name || "", Boolean(data.rule_applied),
      data.status || "SUCCESS", data.error_message || "", now
    ]);
    return;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare(`
      INSERT INTO processed_posts (
        automation_id, platform, source_id, post_id, post_permalink,
        post_message, ad_id, creative_id, ad_name, rule_applied, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (post_id) DO NOTHING
    `);
    stmt.run(
      data.automation_id, data.platform, data.source_id, data.post_id,
      data.post_permalink || "", data.post_message || "", data.ad_id || "",
      data.creative_id || "", data.ad_name || "", data.rule_applied ? 1 : 0,
      data.status || "SUCCESS", data.error_message || "", now
    );
    return;
  }
  if (!jsonState.processed_posts.some(p => p.post_id === data.post_id)) {
    jsonState.processed_posts.push({ ...data, created_at: now });
    saveJsonStore();
  }
}

async function getProcessedPosts(limit = 100) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM processed_posts ORDER BY created_at DESC LIMIT $1", [limit]);
    return res.rows;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("SELECT * FROM processed_posts ORDER BY created_at DESC LIMIT ?");
    return stmt.all(limit);
  }
  return [...jsonState.processed_posts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
}

async function recordLog(data) {
  const now = new Date().toISOString();
  const details = typeof data.details === "object" ? JSON.stringify(data.details) : String(data.details || "");
  if (dbType === "postgres") {
    await pgPool.query(`
      INSERT INTO execution_logs (
        automation_id, automation_name, trigger_type, posts_found, ads_created, errors_count, details, executed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      data.automation_id || "", data.automation_name || "", data.trigger_type || "CRON",
      data.posts_found || 0, data.ads_created || 0, data.errors_count || 0, details, now
    ]);
    return;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare(`
      INSERT INTO execution_logs (
        automation_id, automation_name, trigger_type, posts_found, ads_created, errors_count, details, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      data.automation_id || "", data.automation_name || "", data.trigger_type || "CRON",
      data.posts_found || 0, data.ads_created || 0, data.errors_count || 0, details, now
    );
    return;
  }
  jsonState.execution_logs.push({ ...data, details, executed_at: now });
  if (jsonState.execution_logs.length > 200) jsonState.execution_logs = jsonState.execution_logs.slice(-200);
  saveJsonStore();
}

async function getLogs(limit = 100) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM execution_logs ORDER BY executed_at DESC LIMIT $1", [limit]);
    return res.rows;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("SELECT * FROM execution_logs ORDER BY executed_at DESC LIMIT ?");
    return stmt.all(limit);
  }
  return [...jsonState.execution_logs].sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at)).slice(0, limit);
}

async function getSetting(key) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT value FROM app_settings WHERE key = $1", [key]);
    return res.rows[0]?.value || null;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("SELECT value FROM app_settings WHERE key = ?");
    const row = stmt.get(key);
    return row?.value || null;
  }
  return jsonState.app_settings[key] || null;
}

async function setSetting(key, value) {
  if (dbType === "postgres") {
    await pgPool.query(`
      INSERT INTO app_settings (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [key, value]);
    return;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(key, value);
    return;
  }
  jsonState.app_settings[key] = value;
  saveJsonStore();
}

function getDbType() {
  return dbType;
}

module.exports = {
  initDb,
  getDbType,
  getAutomations,
  getAutomation,
  saveAutomation,
  deleteAutomation,
  toggleAutomation,
  updateAutomationCheckResult,
  isPostProcessed,
  recordProcessedPost,
  getProcessedPosts,
  recordLog,
  getLogs,
  getSetting,
  setSetting
};
