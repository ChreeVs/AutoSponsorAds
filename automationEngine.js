const db = require("./db");

function normalizeContentText(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u2060]/g, " ")
    .replace(/[＃﹟]/g, "#")
    .trim();
}

function parseFilterKeywords(filterKeywords) {
  if (!filterKeywords || !filterKeywords.trim()) return [];
  const cleaned = normalizeContentText(filterKeywords);
  // Split by commas, semicolons, newlines first
  const parts = cleaned.split(/[,;\r\n]+/);
  const keywords = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // If the part contains multiple space-separated hashtags like '#sponsor #adv', split them
    if (trimmed.includes("#")) {
      const tags = trimmed.match(/#[^\s#]+/g);
      if (tags && tags.length > 1) {
        tags.forEach(t => keywords.push(t.toLowerCase().trim()));
        const rest = trimmed.replace(/#[^\s#]+/g, " ").trim();
        if (rest) keywords.push(rest.toLowerCase());
        continue;
      }
    }
    keywords.push(trimmed.toLowerCase());
  }
  return keywords.filter(Boolean);
}

function escapeRegexPattern(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
    const keywords = parseFilterKeywords(filterKeywords);
    if (!keywords.length) return true;
    const target = normalizeContentText(text).toLowerCase();
    if (!target) return false;

    return keywords.some(k => {
      if (k.startsWith("#")) {
        const tagBody = escapeRegexPattern(k.slice(1));
        const regex = new RegExp("#" + tagBody + "(?![\\p{L}\\p{N}_])", "iu");
        return regex.test(target);
      }
      const wordBody = escapeRegexPattern(k);
      const regex = new RegExp("(?:#|\\b)" + wordBody + "(?![\\p{L}\\p{N}_])", "iu");
      return regex.test(target);
    });
  }

  shouldExclude(text, excludeKeywords) {
    if (!excludeKeywords || !excludeKeywords.trim()) return false;
    return this.matchesKeywords(text, excludeKeywords);
  }

  async findMatchingTimelineDecision(post) {
    try {
      const allDecisions = await db.getTimelineDecisions();
      const entries = Object.values(allDecisions);
      if (!entries.length) return null;

      // 1. Match by permalink or Instagram shortcode
      if (post.permalink) {
        const shortcode = post.permalink.match(/\/p\/([^\/]+)/)?.[1];
        const match = entries.find(d => {
          if (d.post_permalink && d.post_permalink === post.permalink) return true;
          if (shortcode && d.post_permalink && d.post_permalink.includes(shortcode)) return true;
          return false;
        });
        if (match) return match;
      }

      // 2. Match by post caption / text
      if (post.message && post.message.trim()) {
        const cleanPost = post.message.slice(0, 40).trim().toLowerCase();
        if (cleanPost.length >= 10) {
          const match = entries.find(d => {
            const decText = (d.post_text || d.notes || "").slice(0, 40).trim().toLowerCase();
            return decText && (decText === cleanPost || decText.includes(cleanPost) || cleanPost.includes(decText));
          });
          if (match) return match;
        }
      }
    } catch {
      // Ignore lookup errors
    }
    return null;
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
          message: normalizeContentText(p.caption || ""),
          permalink: p.permalink || "",
          createdTime: p.timestamp
        }));
      }

      report.postsFound = rawPosts.length;

      // STRICT NON-RETROACTIVE FILTER:
      // Only posts published strictly AFTER the automation's start_time / created_at date!
      const rawStartTime = automation.start_time || automation.created_at;
      const startTimeMs = rawStartTime ? new Date(rawStartTime).getTime() : Date.now();

      const createdAdIdsForRule = [];
      let currentAdsetId = automation.adset_id;

      for (const post of rawPosts) {
        // 1. Check publication date - STRICT! Post must be newer than start time!
        const postTime = post.createdTime ? new Date(post.createdTime).getTime() : 0;
        if (!postTime || postTime < startTimeMs) {
          report.skippedCount++;
          // Post is older than the automation start time - NEVER sponsor retroactively!
          continue;
        }

        // 2. Check if already processed
        const alreadyDone = await db.isPostProcessed(post.id);
        if (alreadyDone) {
          report.skippedCount++;
          continue;
        }

        // 2b. Check Timeline Flow Decision (User curated flow)
        let timelineDecision = await db.getTimelineDecision(post.id);
        if (!timelineDecision) {
          timelineDecision = await this.findMatchingTimelineDecision(post);
        }

        if (timelineDecision && timelineDecision.sponsorship_status === "EXCLUDED") {
          console.log(`[ENGINE] Post ${post.id} escluso dalla sponsorizzazione per decisione nella Linea Temporale (Flow).`);
          report.skippedCount++;
          continue;
        }

        // 3. Check keywords/hashtags filter (inclusion)
        if (!this.matchesKeywords(post.message, automation.filter_keywords)) {
          console.log(`[ENGINE] Post ${post.id} (${automation.platform}) saltato: non contiene gli hashtag/keyword richiesti ("${automation.filter_keywords}")`);
          report.skippedCount++;
          continue;
        }

        // 3b. Check exclusion filter (hashtags or keywords that prevent sponsoring)
        if (this.shouldExclude(post.message, automation.exclude_keywords)) {
          console.log(`[ENGINE] Post ${post.id} (${automation.platform}) escluso da sponsorizzazione per filtro esclusione: "${automation.exclude_keywords}"`);
          report.skippedCount++;
          continue;
        }

        // 4. AdSet 50-Ads Capacity Check & Auto-Management
        try {
          const existingAds = await this.meta.getAdsetAds(currentAdsetId);
          const activeOrPausedAds = existingAds.filter(a => a.status !== "ARCHIVED");

          if (activeOrPausedAds.length >= 49) {
            const strategy = automation.adset_full_strategy || "ROTATE_OLDEST";
            console.log(`[ENGINE] Gruppo inserzioni ${currentAdsetId} ha ${activeOrPausedAds.length}/50 inserzioni. Applico strategia: ${strategy}`);

            if (strategy === "ROTATE_OLDEST") {
              const sorted = [...activeOrPausedAds].sort((a, b) => new Date(a.created_time || 0) - new Date(b.created_time || 0));
              const oldest = sorted[0];
              if (oldest) {
                await this.meta.archiveAd(oldest.id);
                console.log(`[ENGINE] Archiviata inserzione più vecchia: ${oldest.name} (${oldest.id}) per liberare slot.`);
              }
            } else if (strategy === "CREATE_NEW_ADSET" || strategy === "CLONE_EXISTING_ADSET") {
              const sourceAdsetId = automation.adset_clone_source_id || currentAdsetId;
              let customName = null;
              if (automation.adset_clone_name_pattern && automation.adset_clone_name_pattern.trim()) {
                const dateFormatted = new Date().toLocaleDateString("it-IT");
                customName = automation.adset_clone_name_pattern
                  .replace(/\{date\}/gi, dateFormatted)
                  .replace(/\{adset\}/gi, automation.adset_name || "AdSet")
                  .trim();
              }

              const newAdset = await this.meta.cloneAdset(automation.ad_account_id, sourceAdsetId, customName);
              currentAdsetId = newAdset.id;
              automation.adset_id = newAdset.id;
              automation.adset_name = newAdset.name || automation.adset_name;
              await db.saveAutomation(automation);
              console.log(`[ENGINE] Creato nuovo AdSet ${newAdset.id} ("${newAdset.name}") [STATO: ATTIVO] duplicando da ${sourceAdsetId} per proseguire l'automazione.`);
            } else if (strategy === "STOP_AND_ALERT") {
              report.errorsCount++;
              report.errors.push({
                postId: post.id,
                error: `Gruppo inserzioni ${currentAdsetId} pieno (50/50 inserzioni raggiunte). Automazione in attesa.`
              });
              continue;
            }
          }
        } catch (capErr) {
          console.warn("[ENGINE] Errore verifica capacità AdSet:", capErr.message);
        }

        // 5. Eligible for sponsoring!
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

          // Create Ad in currentAdsetId
          const ad = await this.meta.graphPost(`/${automation.ad_account_id}/ads`, {
            name: adName,
            adset_id: currentAdsetId,
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

          // Sync timeline decision state
          try {
            if (timelineDecision && timelineDecision.post_id) {
              await db.saveTimelineDecision(timelineDecision.post_id, {
                sponsorship_status: "SPONSORED",
                ad_id: ad.id,
                notes: `Sponsorizzato con successo da automazione "${automation.name}"`
              });
            }
            await db.saveTimelineDecision(post.id, {
              source: automation.platform === "Facebook" ? "facebook" : "instagram",
              channel_id: automation.source_id,
              sponsorship_status: "SPONSORED",
              ad_id: ad.id,
              notes: `Sponsorizzato con successo da automazione "${automation.name}"`
            });
          } catch (syncErr) {
            console.warn("[ENGINE] Sync timeline decision error:", syncErr.message);
          }

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

  async getNextCheckInfo() {
    try {
      const automations = await db.getAutomations();
      const active = automations.filter(a => a.enabled);
      if (!active.length) {
        return {
          hasActive: false,
          isRunning: this.isRunning,
          nextDueMs: null,
          nextCheckDate: null,
          targetAutomation: null,
          activeCount: 0,
          totalCount: automations.length
        };
      }

      const now = Date.now();
      let earliestNextCheck = Infinity;
      let earliestAuto = null;

      for (const auto of active) {
        const intervalMs = (auto.check_interval_hours || 12) * 3600 * 1000;
        const lastCheck = auto.last_checked_at ? new Date(auto.last_checked_at).getTime() : 0;
        const nextCheck = lastCheck ? (lastCheck + intervalMs) : now;
        if (nextCheck < earliestNextCheck) {
          earliestNextCheck = nextCheck;
          earliestAuto = auto;
        }
      }

      const remainingMs = Math.max(0, earliestNextCheck - now);
      return {
        hasActive: true,
        isRunning: this.isRunning,
        nextDueMs: remainingMs,
        nextCheckDate: earliestNextCheck < Infinity ? new Date(earliestNextCheck).toISOString() : null,
        targetAutomation: earliestAuto ? {
          id: earliestAuto.id,
          name: earliestAuto.name,
          platform: earliestAuto.platform
        } : null,
        activeCount: active.length,
        totalCount: automations.length
      };
    } catch (err) {
      console.warn("[ENGINE] Errore calcolo nextCheckInfo:", err.message);
      return {
        hasActive: false,
        isRunning: this.isRunning,
        error: err.message
      };
    }
  }
}

module.exports = AutomationEngine;
