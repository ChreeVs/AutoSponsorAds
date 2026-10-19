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
  app_settings: {},
  pubblie_mappings: [],
  timeline_decisions: {}
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

    CREATE TABLE IF NOT EXISTS pubblie_mappings (
      id VARCHAR(128) PRIMARY KEY,
      project_id VARCHAR(128) NOT NULL,
      project_name VARCHAR(255) DEFAULT '',
      channel_id VARCHAR(128) NOT NULL,
      channel_name VARCHAR(255) DEFAULT '',
      channel_provider VARCHAR(64) DEFAULT '',
      ad_account_id VARCHAR(128) NOT NULL,
      ad_account_name VARCHAR(255) DEFAULT '',
      campaign_id VARCHAR(128) NOT NULL,
      campaign_name VARCHAR(255) DEFAULT '',
      adset_id VARCHAR(128) NOT NULL,
      adset_name VARCHAR(255) DEFAULT '',
      rule_id VARCHAR(128) DEFAULT '',
      rule_name VARCHAR(255) DEFAULT '',
      automation_id VARCHAR(64) DEFAULT '',
      ad_name_pattern VARCHAR(255) DEFAULT 'ADV - {platform} - {post}',
      ad_status VARCHAR(32) DEFAULT 'PAUSED',
      auto_sponsor_on_publish BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS timeline_decisions (
      post_id VARCHAR(128) PRIMARY KEY,
      source VARCHAR(32) DEFAULT 'pubblie',
      project_id VARCHAR(128) DEFAULT '',
      channel_id VARCHAR(128) DEFAULT '',
      sponsorship_status VARCHAR(32) DEFAULT 'INCLUDED',
      custom_target TEXT DEFAULT '',
      ad_id VARCHAR(128) DEFAULT '',
      notes TEXT DEFAULT '',
      post_text TEXT DEFAULT '',
      post_permalink TEXT DEFAULT '',
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE timeline_decisions ADD COLUMN IF NOT EXISTS post_text TEXT DEFAULT '';
    ALTER TABLE timeline_decisions ADD COLUMN IF NOT EXISTS post_permalink TEXT DEFAULT '';
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

    CREATE TABLE IF NOT EXISTS pubblie_mappings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT DEFAULT '',
      channel_id TEXT NOT NULL,
      channel_name TEXT DEFAULT '',
      channel_provider TEXT DEFAULT '',
      ad_account_id TEXT NOT NULL,
      ad_account_name TEXT DEFAULT '',
      campaign_id TEXT NOT NULL,
      campaign_name TEXT DEFAULT '',
      adset_id TEXT NOT NULL,
      adset_name TEXT DEFAULT '',
      rule_id TEXT DEFAULT '',
      rule_name TEXT DEFAULT '',
      automation_id TEXT DEFAULT '',
      ad_name_pattern TEXT DEFAULT 'ADV - {platform} - {post}',
      ad_status TEXT DEFAULT 'PAUSED',
      auto_sponsor_on_publish INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS timeline_decisions (
      post_id TEXT PRIMARY KEY,
      source TEXT DEFAULT 'pubblie',
      project_id TEXT DEFAULT '',
      channel_id TEXT DEFAULT '',
      sponsorship_status TEXT DEFAULT 'INCLUDED',
      custom_target TEXT DEFAULT '',
      ad_id TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      post_text TEXT DEFAULT '',
      post_permalink TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN start_time TEXT;"); } catch {}
  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN adset_full_strategy TEXT DEFAULT 'ROTATE_OLDEST';"); } catch {}
  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN adset_clone_source_id TEXT DEFAULT '';"); } catch {}
  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN adset_clone_name_pattern TEXT DEFAULT '';"); } catch {}
  try { sqliteDb.exec("ALTER TABLE automations ADD COLUMN exclude_keywords TEXT DEFAULT '';"); } catch {}
  try { sqliteDb.exec("ALTER TABLE timeline_decisions ADD COLUMN post_text TEXT DEFAULT '';"); } catch {}
  try { sqliteDb.exec("ALTER TABLE timeline_decisions ADD COLUMN post_permalink TEXT DEFAULT '';"); } catch {}
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

// -----------------------------------------------------------------------------
// Pubblie & Meta Mappings CRUD
// -----------------------------------------------------------------------------

async function getPubblieMappings(projectId = null) {
  if (dbType === "postgres") {
    let query = "SELECT * FROM pubblie_mappings";
    const params = [];
    if (projectId) {
      query += " WHERE project_id = $1";
      params.push(projectId);
    }
    query += " ORDER BY created_at DESC";
    const res = await pgPool.query(query, params);
    return res.rows.map(r => ({ ...r, auto_sponsor_on_publish: Boolean(r.auto_sponsor_on_publish) }));
  }
  if (dbType === "sqlite") {
    let query = "SELECT * FROM pubblie_mappings";
    const params = [];
    if (projectId) {
      query += " WHERE project_id = ?";
      params.push(projectId);
    }
    query += " ORDER BY created_at DESC";
    const stmt = sqliteDb.prepare(query);
    const rows = params.length ? stmt.all(...params) : stmt.all();
    return rows.map(r => ({ ...r, auto_sponsor_on_publish: Boolean(r.auto_sponsor_on_publish) }));
  }
  let list = Array.isArray(jsonState.pubblie_mappings) ? jsonState.pubblie_mappings : [];
  if (projectId) {
    list = list.filter(m => m.project_id === projectId);
  }
  return [...list].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

async function getPubblieMapping(id) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM pubblie_mappings WHERE id = $1", [id]);
    const r = res.rows[0];
    return r ? { ...r, auto_sponsor_on_publish: Boolean(r.auto_sponsor_on_publish) } : null;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("SELECT * FROM pubblie_mappings WHERE id = ?");
    const r = stmt.get(id);
    return r ? { ...r, auto_sponsor_on_publish: Boolean(r.auto_sponsor_on_publish) } : null;
  }
  const list = Array.isArray(jsonState.pubblie_mappings) ? jsonState.pubblie_mappings : [];
  return list.find(m => m.id === id) || null;
}

async function findPubblieMapping(channelId, projectId = null) {
  if (dbType === "postgres") {
    if (channelId) {
      const res = await pgPool.query("SELECT * FROM pubblie_mappings WHERE channel_id = $1 LIMIT 1", [channelId]);
      if (res.rows[0]) return { ...res.rows[0], auto_sponsor_on_publish: Boolean(res.rows[0].auto_sponsor_on_publish) };
    }
    if (projectId) {
      const res = await pgPool.query("SELECT * FROM pubblie_mappings WHERE project_id = $1 LIMIT 1", [projectId]);
      if (res.rows[0]) return { ...res.rows[0], auto_sponsor_on_publish: Boolean(res.rows[0].auto_sponsor_on_publish) };
    }
    return null;
  }
  if (dbType === "sqlite") {
    if (channelId) {
      const stmt = sqliteDb.prepare("SELECT * FROM pubblie_mappings WHERE channel_id = ? LIMIT 1");
      const r = stmt.get(channelId);
      if (r) return { ...r, auto_sponsor_on_publish: Boolean(r.auto_sponsor_on_publish) };
    }
    if (projectId) {
      const stmt = sqliteDb.prepare("SELECT * FROM pubblie_mappings WHERE project_id = ? LIMIT 1");
      const r = stmt.get(projectId);
      if (r) return { ...r, auto_sponsor_on_publish: Boolean(r.auto_sponsor_on_publish) };
    }
    return null;
  }
  const list = Array.isArray(jsonState.pubblie_mappings) ? jsonState.pubblie_mappings : [];
  if (channelId) {
    const found = list.find(m => m.channel_id === channelId);
    if (found) return found;
  }
  if (projectId) {
    return list.find(m => m.project_id === projectId) || null;
  }
  return null;
}

async function savePubblieMapping(item) {
  const now = new Date().toISOString();
  const id = item.id || `pubmap_${item.project_id}_${item.channel_id || "all"}`;
  const record = {
    id,
    project_id: item.project_id,
    project_name: item.project_name || "",
    channel_id: item.channel_id || "",
    channel_name: item.channel_name || "",
    channel_provider: item.channel_provider || "",
    ad_account_id: item.ad_account_id,
    ad_account_name: item.ad_account_name || "",
    campaign_id: item.campaign_id,
    campaign_name: item.campaign_name || "",
    adset_id: item.adset_id,
    adset_name: item.adset_name || "",
    rule_id: item.rule_id || "",
    rule_name: item.rule_name || "",
    automation_id: item.automation_id || "",
    ad_name_pattern: item.ad_name_pattern || "ADV - {platform} - {post}",
    ad_status: item.ad_status || "PAUSED",
    auto_sponsor_on_publish: item.auto_sponsor_on_publish ?? true,
    created_at: item.created_at || now,
    updated_at: now
  };

  if (dbType === "postgres") {
    await pgPool.query(`
      INSERT INTO pubblie_mappings (
        id, project_id, project_name, channel_id, channel_name, channel_provider,
        ad_account_id, ad_account_name, campaign_id, campaign_name, adset_id, adset_name,
        rule_id, rule_name, automation_id, ad_name_pattern, ad_status, auto_sponsor_on_publish,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      ON CONFLICT (id) DO UPDATE SET
        project_name = EXCLUDED.project_name,
        channel_name = EXCLUDED.channel_name,
        channel_provider = EXCLUDED.channel_provider,
        ad_account_id = EXCLUDED.ad_account_id,
        ad_account_name = EXCLUDED.ad_account_name,
        campaign_id = EXCLUDED.campaign_id,
        campaign_name = EXCLUDED.campaign_name,
        adset_id = EXCLUDED.adset_id,
        adset_name = EXCLUDED.adset_name,
        rule_id = EXCLUDED.rule_id,
        rule_name = EXCLUDED.rule_name,
        automation_id = EXCLUDED.automation_id,
        ad_name_pattern = EXCLUDED.ad_name_pattern,
        ad_status = EXCLUDED.ad_status,
        auto_sponsor_on_publish = EXCLUDED.auto_sponsor_on_publish,
        updated_at = EXCLUDED.updated_at
    `, [
      record.id, record.project_id, record.project_name, record.channel_id, record.channel_name, record.channel_provider,
      record.ad_account_id, record.ad_account_name, record.campaign_id, record.campaign_name, record.adset_id, record.adset_name,
      record.rule_id, record.rule_name, record.automation_id, record.ad_name_pattern, record.ad_status, record.auto_sponsor_on_publish,
      record.created_at, record.updated_at
    ]);
    return record;
  }

  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare(`
      INSERT INTO pubblie_mappings (
        id, project_id, project_name, channel_id, channel_name, channel_provider,
        ad_account_id, ad_account_name, campaign_id, campaign_name, adset_id, adset_name,
        rule_id, rule_name, automation_id, ad_name_pattern, ad_status, auto_sponsor_on_publish,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        project_name = excluded.project_name,
        channel_name = excluded.channel_name,
        channel_provider = excluded.channel_provider,
        ad_account_id = excluded.ad_account_id,
        ad_account_name = excluded.ad_account_name,
        campaign_id = excluded.campaign_id,
        campaign_name = excluded.campaign_name,
        adset_id = excluded.adset_id,
        adset_name = excluded.adset_name,
        rule_id = excluded.rule_id,
        rule_name = excluded.rule_name,
        automation_id = excluded.automation_id,
        ad_name_pattern = excluded.ad_name_pattern,
        ad_status = excluded.ad_status,
        auto_sponsor_on_publish = excluded.auto_sponsor_on_publish,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      record.id, record.project_id, record.project_name, record.channel_id, record.channel_name, record.channel_provider,
      record.ad_account_id, record.ad_account_name, record.campaign_id, record.campaign_name, record.adset_id, record.adset_name,
      record.rule_id, record.rule_name, record.automation_id, record.ad_name_pattern, record.ad_status, record.auto_sponsor_on_publish ? 1 : 0,
      record.created_at, record.updated_at
    );
    return record;
  }

  if (!Array.isArray(jsonState.pubblie_mappings)) jsonState.pubblie_mappings = [];
  const idx = jsonState.pubblie_mappings.findIndex(m => m.id === record.id);
  if (idx >= 0) {
    jsonState.pubblie_mappings[idx] = record;
  } else {
    jsonState.pubblie_mappings.push(record);
  }
  saveJsonStore();
  return record;
}

async function deletePubblieMapping(id) {
  if (dbType === "postgres") {
    await pgPool.query("DELETE FROM pubblie_mappings WHERE id = $1", [id]);
    return;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("DELETE FROM pubblie_mappings WHERE id = ?");
    stmt.run(id);
    return;
  }
  if (Array.isArray(jsonState.pubblie_mappings)) {
    jsonState.pubblie_mappings = jsonState.pubblie_mappings.filter(m => m.id !== id);
    saveJsonStore();
  }
}

// -----------------------------------------------------------------------------
// Timeline Decisions CRUD (Included vs Excluded from Sponsorship Flow)
// -----------------------------------------------------------------------------

async function getTimelineDecisions() {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM timeline_decisions");
    const map = {};
    for (const r of res.rows) {
      let customTarget = {};
      try { customTarget = r.custom_target ? JSON.parse(r.custom_target) : {}; } catch {}
      map[r.post_id] = { ...r, custom_target: customTarget };
    }
    return map;
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("SELECT * FROM timeline_decisions");
    const rows = stmt.all();
    const map = {};
    for (const r of rows) {
      let customTarget = {};
      try { customTarget = r.custom_target ? JSON.parse(r.custom_target) : {}; } catch {}
      map[r.post_id] = { ...r, custom_target: customTarget };
    }
    return map;
  }
  return jsonState.timeline_decisions || {};
}

async function getTimelineDecision(postId) {
  if (!postId) return null;
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM timeline_decisions WHERE post_id = $1", [postId]);
    const r = res.rows[0];
    if (!r) return null;
    let customTarget = {};
    try { customTarget = r.custom_target ? JSON.parse(r.custom_target) : {}; } catch {}
    return { ...r, custom_target: customTarget };
  }
  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare("SELECT * FROM timeline_decisions WHERE post_id = ?");
    const r = stmt.get(postId);
    if (!r) return null;
    let customTarget = {};
    try { customTarget = r.custom_target ? JSON.parse(r.custom_target) : {}; } catch {}
    return { ...r, custom_target: customTarget };
  }
  return jsonState.timeline_decisions?.[postId] || null;
}

async function saveTimelineDecision(postId, data = {}) {
  const now = new Date().toISOString();
  const status = data.sponsorship_status || data.status || "INCLUDED";
  const source = data.source || "pubblie";
  const projectId = data.project_id || "";
  const channelId = data.channel_id || "";
  const customTargetStr = typeof data.custom_target === "object" ? JSON.stringify(data.custom_target) : (data.custom_target || "");
  const adId = data.ad_id || "";
  const notes = data.notes || "";

  const postText = data.post_text || data.postText || "";
  const postPermalink = data.post_permalink || data.postPermalink || "";

  if (dbType === "postgres") {
    try {
      await pgPool.query(`
        INSERT INTO timeline_decisions (
          post_id, source, project_id, channel_id, sponsorship_status, custom_target, ad_id, notes, post_text, post_permalink, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (post_id) DO UPDATE SET
          sponsorship_status = EXCLUDED.sponsorship_status,
          custom_target = CASE WHEN EXCLUDED.custom_target <> '' THEN EXCLUDED.custom_target ELSE timeline_decisions.custom_target END,
          ad_id = CASE WHEN EXCLUDED.ad_id <> '' THEN EXCLUDED.ad_id ELSE timeline_decisions.ad_id END,
          notes = CASE WHEN EXCLUDED.notes <> '' THEN EXCLUDED.notes ELSE timeline_decisions.notes END,
          post_text = CASE WHEN EXCLUDED.post_text <> '' THEN EXCLUDED.post_text ELSE timeline_decisions.post_text END,
          post_permalink = CASE WHEN EXCLUDED.post_permalink <> '' THEN EXCLUDED.post_permalink ELSE timeline_decisions.post_permalink END,
          updated_at = EXCLUDED.updated_at
      `, [postId, source, projectId, channelId, status, customTargetStr, adId, notes, postText, postPermalink, now]);
    } catch (err) {
      if (err.message && (err.message.includes("post_text") || err.message.includes("post_permalink") || err.code === "42703")) {
        console.warn("[DB] Migrazione 'timeline_decisions' eseguita a caldo per PostgreSQL...");
        await pgPool.query("ALTER TABLE timeline_decisions ADD COLUMN IF NOT EXISTS post_text TEXT DEFAULT '';");
        await pgPool.query("ALTER TABLE timeline_decisions ADD COLUMN IF NOT EXISTS post_permalink TEXT DEFAULT '';");
        await pgPool.query(`
          INSERT INTO timeline_decisions (
            post_id, source, project_id, channel_id, sponsorship_status, custom_target, ad_id, notes, post_text, post_permalink, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (post_id) DO UPDATE SET
            sponsorship_status = EXCLUDED.sponsorship_status,
            custom_target = CASE WHEN EXCLUDED.custom_target <> '' THEN EXCLUDED.custom_target ELSE timeline_decisions.custom_target END,
            ad_id = CASE WHEN EXCLUDED.ad_id <> '' THEN EXCLUDED.ad_id ELSE timeline_decisions.ad_id END,
            notes = CASE WHEN EXCLUDED.notes <> '' THEN EXCLUDED.notes ELSE timeline_decisions.notes END,
            post_text = CASE WHEN EXCLUDED.post_text <> '' THEN EXCLUDED.post_text ELSE timeline_decisions.post_text END,
            post_permalink = CASE WHEN EXCLUDED.post_permalink <> '' THEN EXCLUDED.post_permalink ELSE timeline_decisions.post_permalink END,
            updated_at = EXCLUDED.updated_at
        `, [postId, source, projectId, channelId, status, customTargetStr, adId, notes, postText, postPermalink, now]);
      } else {
        throw err;
      }
    }
    return { post_id: postId, sponsorship_status: status, updated_at: now };
  }

  if (dbType === "sqlite") {
    const stmt = sqliteDb.prepare(`
      INSERT INTO timeline_decisions (
        post_id, source, project_id, channel_id, sponsorship_status, custom_target, ad_id, notes, post_text, post_permalink, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (post_id) DO UPDATE SET
        sponsorship_status = excluded.sponsorship_status,
        custom_target = CASE WHEN excluded.custom_target <> '' THEN excluded.custom_target ELSE timeline_decisions.custom_target END,
        ad_id = CASE WHEN excluded.ad_id <> '' THEN excluded.ad_id ELSE timeline_decisions.ad_id END,
        notes = CASE WHEN excluded.notes <> '' THEN excluded.notes ELSE timeline_decisions.notes END,
        post_text = CASE WHEN excluded.post_text <> '' THEN excluded.post_text ELSE timeline_decisions.post_text END,
        post_permalink = CASE WHEN excluded.post_permalink <> '' THEN excluded.post_permalink ELSE timeline_decisions.post_permalink END,
        updated_at = excluded.updated_at
    `);
    stmt.run(postId, source, projectId, channelId, status, customTargetStr, adId, notes, postText, postPermalink, now);
    return { post_id: postId, sponsorship_status: status, updated_at: now };
  }

  if (!jsonState.timeline_decisions) jsonState.timeline_decisions = {};
  jsonState.timeline_decisions[postId] = {
    post_id: postId,
    source,
    project_id: projectId,
    channel_id: channelId,
    sponsorship_status: status,
    custom_target: typeof data.custom_target === "object" ? data.custom_target : {},
    ad_id: adId,
    notes,
    post_text: postText,
    post_permalink: postPermalink,
    updated_at: now
  };
  saveJsonStore();
  return jsonState.timeline_decisions[postId];
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
  setSetting,
  getPubblieMappings,
  getPubblieMapping,
  findPubblieMapping,
  savePubblieMapping,
  deletePubblieMapping,
  getTimelineDecisions,
  getTimelineDecision,
  saveTimelineDecision
};

