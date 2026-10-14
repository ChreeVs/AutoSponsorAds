const db = require("./db");

class AutomationEngine {
  constructor(metaService) {
    this.meta = metaService;
    this.schedulerTimer = null;
    this.isRunning = false;
  }

  formatAdName(pattern, { platform, postText, postId, postDate }) {
    const dateStr = postDate ? new Date(postDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const cleanText = (postText || "Post")
      .replace(/[\r\n]+/g, " ")
      .replace(/[^\p{L}\p{N}\s\-_]/gu, "")
      .trim()
      .slice(0, 35);

    const safePattern = pattern || "ADV - {platform} - {post}";
    return safePattern
      .replace(/\{platform\}/gi, platform === "Facebook" ? "FB" : "IG")
      .replace(/\{post\}/gi, cleanText || "Post")
      .replace(/\{date\}/gi, dateStr)
      .replace(/\{id\}/gi, String(postId).slice(-6))
      .trim();
  }

  matchesKeywords(text, filterKeywords) {
    if (!filterKeywords || !filterKeywords.trim()) return true;
    const keywords = filterKeywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
    if (!keywords.length) return true;
    const lower = (text || "").toLowerCase();
    return keywords.some(k => lower.includes(k));
  }

  async runSingleAutomation(automationId, triggerType = "MANUAL", force = false) {
    const automation = await db.getAutomation(automationId);
    if (!automation) throw new Error("Automazione non trovata");
    if (!automation.enabled && !force) {
      return { skipped: true, reason: "Automazione disattivata" };
    }

    const report = {
      automationId: automation.id,
      automationName: automation.name,
      triggerType,
      platform: automation.platform,
      postsFound: 0,
      adsCreated: 0,
      skippedCount: 0,
      errorsCount: 0,
      createdAds: [],
      errors: []
    };

    console.log(`[ENGINE] Avvio controllo automazione "${automation.name}" (${automation.platform} - ${automation.source_name || automation.source_id})`);

    try {
      let rawPosts = [];
      if (automation.platform === "Facebook") {
        const payload = await this.meta.getFacebookPosts(automation.source_id, 25);
        rawPosts = (payload.data || []).map(p => ({
          id: p.id,
          message: p.message || p.attachments?.data?.[0]?.title || "",
          permalink: p.permalink_url || "",
          createdTime: p.created_time
        }));
      } else {
        const payload = await this.meta.getInstagramMedia(automation.source_id, automation.page_id, 25);
        rawPosts = (payload.data || []).map(p => ({
          id: p.id,
          message: p.caption || "",
          permalink: p.permalink || "",
          createdTime: p.timestamp
        }));
      }

      report.postsFound = rawPosts.length;

      // Filter: only posts created within last 7 days or after automation creation
      const automationCreatedAt = automation.created_at ? new Date(automation.created_at).getTime() : 0;
      const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
      const minTimestamp = Math.max(automationCreatedAt, sevenDaysAgo);

      const createdAdIdsForRule = [];

      for (const post of rawPosts) {
        // 1. Check if already processed
        const alreadyDone = await db.isPostProcessed(post.id);
        if (alreadyDone) {
          report.skippedCount++;
          continue;
        }

        // 2. Check publication date (avoid massive backfill on first run)
        const postTime = post.createdTime ? new Date(post.createdTime).getTime() : 0;
        if (postTime && postTime < minTimestamp && !force) {
          report.skippedCount++;
          continue;
        }

        // 3. Check keywords/hashtags filter
        if (!this.matchesKeywords(post.message, automation.filter_keywords)) {
          report.skippedCount++;
          continue;
        }

        // 4. Eligible for sponsoring!
        const adName = this.formatAdName(automation.ad_name_pattern, {
          platform: automation.platform,
          postText: post.message,
          postId: post.id,
          postDate: post.createdTime
        });

        try {
          // Prepare Creative
          const creativeParams = {
            name: adName,
            status: "ACTIVE"
          };

          if (automation.platform === "Facebook") {
            creativeParams.object_story_id = post.id;
          } else {
            const pageId = automation.page_id || this.meta.pageForInstagramId(automation.source_id)?.id;
            creativeParams.object_id = pageId;
            creativeParams.instagram_user_id = automation.source_id;
            creativeParams.source_instagram_media_id = post.id;
          }

          const creative = await this.meta.graphPost(`/${automation.ad_account_id}/adcreatives`, creativeParams);

          // Create Ad
          const ad = await this.meta.graphPost(`/${automation.ad_account_id}/ads`, {
            name: adName,
            adset_id: automation.adset_id,
            creative: { creative_id: creative.id },
            status: automation.ad_status || "PAUSED"
          });

          let ruleApplied = false;
          if (automation.rule_id) {
            createdAdIdsForRule.push(ad.id);
          }

          await db.recordProcessedPost({
            automation_id: automation.id,
            platform: automation.platform,
            source_id: automation.source_id,
            post_id: post.id,
            post_permalink: post.permalink,
            post_message: post.message.slice(0, 200),
            ad_id: ad.id,
            creative_id: creative.id,
            ad_name: adName,
            rule_applied: ruleApplied,
            status: "SUCCESS"
          });

          report.adsCreated++;
          report.createdAds.push({
            postId: post.id,
            adId: ad.id,
            adName,
            permalink: post.permalink
          });
        } catch (adError) {
          console.error(`[ENGINE] Errore creazione inserzione per post ${post.id}:`, adError.message);
          report.errorsCount++;
          report.errors.push({
            postId: post.id,
            error: adError.message,
            meta: adError.meta || null
          });

          // Record as FAILED so we don't retry endlessly if the media isn't eligible
          await db.recordProcessedPost({
            automation_id: automation.id,
            platform: automation.platform,
            source_id: automation.source_id,
            post_id: post.id,
            post_permalink: post.permalink,
            post_message: post.message.slice(0, 200),
            status: "FAILED",
            error_message: adError.message
          });
        }
      }

      // If any ads were created and a rule is specified, apply rule
      if (automation.rule_id && createdAdIdsForRule.length > 0) {
        try {
          const ruleResult = await this.meta.applyRuleToCreatedAds(
            automation.ad_account_id,
            automation.rule_id,
            createdAdIdsForRule
          );
          console.log(`[ENGINE] Regola applicata per ${createdAdIdsForRule.length} inserzioni:`, ruleResult.message);
        } catch (ruleError) {
          console.error(`[ENGINE] Errore aggiornamento regola Meta:`, ruleError.message);
          report.errors.push({
            type: "RULE_UPDATE_ERROR",
            error: ruleError.message
          });
        }
      }

      const status = report.errorsCount > 0 ? (report.adsCreated > 0 ? "WARNING" : "ERROR") : "SUCCESS";
      const message = `Post trovati: ${report.postsFound}, Inserzioni create: ${report.adsCreated}, Saltati: ${report.skippedCount}, Errori: ${report.errorsCount}`;

      await db.updateAutomationCheckResult(automation.id, status, message);
      await db.recordLog({
        automation_id: automation.id,
        automation_name: automation.name,
        trigger_type: triggerType,
        posts_found: report.postsFound,
        ads_created: report.adsCreated,
        errors_count: report.errorsCount,
        details: report
      });

      return report;
    } catch (globalError) {
      console.error(`[ENGINE] Errore esecuzione automazione "${automation.name}":`, globalError.message);
      await db.updateAutomationCheckResult(automation.id, "ERROR", globalError.message);
      await db.recordLog({
        automation_id: automation.id,
        automation_name: automation.name,
        trigger_type: triggerType,
        posts_found: 0,
        ads_created: 0,
        errors_count: 1,
        details: { error: globalError.message, meta: globalError.meta || null }
      });
      throw globalError;
    }
  }

  async runAllDueAutomations(triggerType = "CRON", forceAll = false) {
    if (this.isRunning) {
      return { skipped: true, reason: "Un ciclo di automazione è già in corso" };
    }

    this.isRunning = true;
    const automations = await db.getAutomations();
    const activeAutomations = automations.filter(a => a.enabled);

    console.log(`[ENGINE] Controllo schedulato avviato (${triggerType}). Regole attive totali: ${activeAutomations.length}`);

    const results = [];
    const now = Date.now();

    for (const automation of activeAutomations) {
      const intervalMs = (automation.check_interval_hours || 12) * 3600 * 1000;
      const lastCheckTime = automation.last_checked_at ? new Date(automation.last_checked_at).getTime() : 0;
      const isDue = forceAll || (now - lastCheckTime >= intervalMs);

      if (isDue) {
        try {
          const report = await this.runSingleAutomation(automation.id, triggerType, forceAll);
          results.push(report);
        } catch (err) {
          results.push({
            automationId: automation.id,
            automationName: automation.name,
            error: err.message
          });
        }
      } else {
        const nextDueInMinutes = Math.round((intervalMs - (now - lastCheckTime)) / 60000);
        console.log(`[ENGINE] Automazione "${automation.name}" non ancora dovuta (prossimo controllo tra ~${nextDueInMinutes} min)`);
      }
    }

    this.isRunning = false;
    return {
      triggerType,
      executedCount: results.length,
      totalActive: activeAutomations.length,
      results
    };
  }

  startInternalScheduler() {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);

    // Run check every 15 minutes when process is alive
    const CHECK_INTERVAL_MS = 15 * 60 * 1000;
    this.schedulerTimer = setInterval(() => {
      this.runAllDueAutomations("INTERNAL_SCHEDULER").catch(err => {
        console.error("[ENGINE] Errore nello scheduler interno:", err.message);
      });
    }, CHECK_INTERVAL_MS);

    console.log("[ENGINE] Schedulatore interno avviato (controllo ogni 15 minuti)");
  }

  stopInternalScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }
}

module.exports = AutomationEngine;
