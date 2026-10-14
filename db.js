const path = require("path");
const fs = require("fs");

let pgPool = null;
let sqliteDb = null;
let dbType = "none";

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

async function initDb(databaseUrl) {
  if (databaseUrl && (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://"))) {
    try {
      const { Pool } = require("pg");
      pgPool = new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false }
      });
      // Test connection
      await pgPool.query("SELECT 1");
      dbType = "postgres";
      console.log("[DB] Connesso con successo a PostgreSQL cloud");
      await setupPostgresSchema();
      return;
    } catch (err) {
      console.error("[DB] Errore connessione PostgreSQL, fallback a SQLite locale:", err.message);
      pgPool = null;
    }
  }

  // Fallback to SQLite (built-in node:sqlite in Node 22+)
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const { DatabaseSync } = require("node:sqlite");
    const dbPath = path.join(DATA_DIR, "autosponsor.db");
    sqliteDb = new DatabaseSync(dbPath);
    sqliteDb.exec("PRAGMA journal_mode = WAL;");
    dbType = "sqlite";
    console.log(`[DB] Connesso a SQLite locale (${dbPath})`);
    setupSqliteSchema();
  } catch (err) {
    console.error("[DB] Impossibile inizializzare SQLite:", err.message);
    throw err;
  }
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
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      last_checked_at TIMESTAMP WITH TIME ZONE,
      last_run_status VARCHAR(32) DEFAULT 'IDLE',
      last_run_message TEXT DEFAULT ''
    );

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
}

// ----------------------------------------------------
// Public Unified API
// ----------------------------------------------------

async function getAutomations() {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM automations ORDER BY created_at DESC");
    return res.rows.map(row => ({
      ...row,
      enabled: Boolean(row.enabled)
    }));
  }
  const stmt = sqliteDb.prepare("SELECT * FROM automations ORDER BY created_at DESC");
  const rows = stmt.all();
  return rows.map(row => ({
    ...row,
    enabled: Boolean(row.enabled)
  }));
}

async function getAutomation(id) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM automations WHERE id = $1", [id]);
    if (!res.rows.length) return null;
    return { ...res.rows[0], enabled: Boolean(res.rows[0].enabled) };
  }
  const stmt = sqliteDb.prepare("SELECT * FROM automations WHERE id = ?");
  const row = stmt.get(id);
  if (!row) return null;
  return { ...row, enabled: Boolean(row.enabled) };
}

async function saveAutomation(item) {
  const now = new Date().toISOString();
  if (dbType === "postgres") {
    await pgPool.query(`
      INSERT INTO automations (
        id, name, enabled, platform, source_id, source_name, page_id,
        ad_account_id, campaign_id, campaign_name, adset_id, adset_name,
        rule_id, rule_name, ad_name_pattern, ad_status, check_interval_hours,
        filter_keywords, created_at, last_checked_at, last_run_status, last_run_message
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
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
        filter_keywords = EXCLUDED.filter_keywords
    `, [
      item.id, item.name, item.enabled ?? true, item.platform, item.source_id,
      item.source_name || "", item.page_id || "", item.ad_account_id,
      item.campaign_id, item.campaign_name || "", item.adset_id, item.adset_name || "",
      item.rule_id || "", item.rule_name || "", item.ad_name_pattern || "ADV - {platform} - {post}",
      item.ad_status || "PAUSED", item.check_interval_hours || 12, item.filter_keywords || "",
      item.created_at || now, item.last_checked_at || null,
      item.last_run_status || "IDLE", item.last_run_message || ""
    ]);
    return getAutomation(item.id);
  }

  const stmt = sqliteDb.prepare(`
    INSERT INTO automations (
      id, name, enabled, platform, source_id, source_name, page_id,
      ad_account_id, campaign_id, campaign_name, adset_id, adset_name,
      rule_id, rule_name, ad_name_pattern, ad_status, check_interval_hours,
      filter_keywords, created_at, last_checked_at, last_run_status, last_run_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      filter_keywords = excluded.filter_keywords
  `);

  stmt.run(
    item.id, item.name, item.enabled ? 1 : 0, item.platform, item.source_id,
    item.source_name || "", item.page_id || "", item.ad_account_id,
    item.campaign_id, item.campaign_name || "", item.adset_id, item.adset_name || "",
    item.rule_id || "", item.rule_name || "", item.ad_name_pattern || "ADV - {platform} - {post}",
    item.ad_status || "PAUSED", item.check_interval_hours || 12, item.filter_keywords || "",
    item.created_at || now, item.last_checked_at || null,
    item.last_run_status || "IDLE", item.last_run_message || ""
  );

  return getAutomation(item.id);
}

async function deleteAutomation(id) {
  if (dbType === "postgres") {
    await pgPool.query("DELETE FROM automations WHERE id = $1", [id]);
    return true;
  }
  const stmt = sqliteDb.prepare("DELETE FROM automations WHERE id = ?");
  stmt.run(id);
  return true;
}

async function toggleAutomation(id, enabled) {
  if (dbType === "postgres") {
    await pgPool.query("UPDATE automations SET enabled = $1 WHERE id = $2", [enabled, id]);
    return getAutomation(id);
  }
  const stmt = sqliteDb.prepare("UPDATE automations SET enabled = ? WHERE id = ?");
  stmt.run(enabled ? 1 : 0, id);
  return getAutomation(id);
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
  const stmt = sqliteDb.prepare(
    "UPDATE automations SET last_checked_at = ?, last_run_status = ?, last_run_message = ? WHERE id = ?"
  );
  stmt.run(now, status, message, id);
}

async function isPostProcessed(postId) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT 1 FROM processed_posts WHERE post_id = $1", [postId]);
    return res.rows.length > 0;
  }
  const stmt = sqliteDb.prepare("SELECT 1 FROM processed_posts WHERE post_id = ?");
  return Boolean(stmt.get(postId));
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
}

async function getProcessedPosts(limit = 100) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM processed_posts ORDER BY created_at DESC LIMIT $1", [limit]);
    return res.rows;
  }
  const stmt = sqliteDb.prepare("SELECT * FROM processed_posts ORDER BY created_at DESC LIMIT ?");
  return stmt.all(limit);
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
  const stmt = sqliteDb.prepare(`
    INSERT INTO execution_logs (
      automation_id, automation_name, trigger_type, posts_found, ads_created, errors_count, details, executed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.automation_id || "", data.automation_name || "", data.trigger_type || "CRON",
    data.posts_found || 0, data.ads_created || 0, data.errors_count || 0, details, now
  );
}

async function getLogs(limit = 100) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT * FROM execution_logs ORDER BY executed_at DESC LIMIT $1", [limit]);
    return res.rows;
  }
  const stmt = sqliteDb.prepare("SELECT * FROM execution_logs ORDER BY executed_at DESC LIMIT ?");
  return stmt.all(limit);
}

async function getSetting(key) {
  if (dbType === "postgres") {
    const res = await pgPool.query("SELECT value FROM app_settings WHERE key = $1", [key]);
    return res.rows[0]?.value || null;
  }
  const stmt = sqliteDb.prepare("SELECT value FROM app_settings WHERE key = ?");
  const row = stmt.get(key);
  return row?.value || null;
}

async function setSetting(key, value) {
  if (dbType === "postgres") {
    await pgPool.query(`
      INSERT INTO app_settings (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [key, value]);
    return;
  }
  const stmt = sqliteDb.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(key, value);
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

