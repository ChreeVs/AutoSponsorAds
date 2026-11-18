/**
 * Pure filtering, text normalization, post matching, and deduplication utilities for AutoSponsorAds.
 * Ensures:
 * 1. Only Facebook and Instagram channels are treated as Meta-compatible.
 * 2. Only standard "POST" format items are included/sponsored (excluding Stories, Reels, Shorts, Live, Events).
 * 3. Duplicate posts across channels or repeated API entries are deduplicated in Timeline Flow.
 * 4. Published posts on Facebook and Instagram are reliably matched by permalink, normalized text, or scheduled timestamp proximity.
 */

const NON_META_PROVIDERS = [
  "tiktok",
  "linkedin",
  "youtube",
  "google",
  "gmb",
  "business",
  "twitter",
  "x.com",
  "pinterest",
  "threads",
  "telegram",
  "whatsapp",
  "snapchat"
];

const NON_POST_FORMAT_KEYWORDS = [
  "story",
  "stories",
  "storia",
  "storie",
  "reel",
  "reels",
  "short",
  "shorts",
  "live",
  "igtv",
  "event",
  "evento",
  "poll",
  "sondaggio",
  "note"
];

/**
 * Strictly determines whether a provider/channel descriptor belongs to Facebook or Instagram.
 * Returns "Instagram", "Facebook", or null for any other social network.
 */
function detectMetaPlatform(providerStr = "", channelNameStr = "") {
  const p = String(providerStr || "").toLowerCase().trim();
  const name = String(channelNameStr || "").toLowerCase().trim();
  const combined = `${p} ${name}`;

  for (const nonMeta of NON_META_PROVIDERS) {
    if (p.includes(nonMeta)) {
      return null;
    }
  }

  if (p.includes("insta") || p === "ig") {
    return "Instagram";
  }
  if (p.includes("face") || p === "fb") {
    return "Facebook";
  }

  // Fallback check on channel name only if provider is empty or generic "meta"
  if (!p || p === "meta" || p === "social") {
    for (const nonMeta of NON_META_PROVIDERS) {
      if (combined.includes(nonMeta)) return null;
    }
    if (name.includes("instagram") || name.startsWith("ig ") || name.endsWith(" ig")) {
      return "Instagram";
    }
    if (name.includes("facebook") || name.startsWith("fb ") || name.endsWith(" fb")) {
      return "Facebook";
    }
  }

  return null;
}

/**
 * Checks whether a post object (from Pubblie or Meta Graph API) is strictly a standard "POST"
 * and NOT a Story, Reel, Short, Live stream, or Event.
 */
function isStandardPostFormat(post = {}, accountEntry = null) {
  if (!post || typeof post !== "object") return false;

  // 1. Explicit boolean flags
  if (
    post.isStory === true ||
    post.is_story === true ||
    post.isReel === true ||
    post.is_reel === true ||
    post.isShort === true ||
    accountEntry?.isStory === true ||
    accountEntry?.isReel === true
  ) {
    return false;
  }

  // 2. Instagram Graph API media_product_type check
  // In Instagram Graph API, media_product_type is "FEED", "STORY", "REELS", or "AD"
  if (post.media_product_type) {
    const mpt = String(post.media_product_type).toUpperCase().trim();
    if (mpt !== "FEED") {
      return false;
    }
  }

  // 3. Check type/format/placement fields on post and accountEntry
  // Note: Facebook Graph API `status_type` uses values like `shared_story`, `added_photos`, `mobile_status_update`
  // for standard feed posts, so `status_type` must NOT be rejected for containing the word "story".
  const formatCandidates = [
    post.postType,
    post.post_type,
    post.type,
    post.format,
    post.contentType,
    post.content_type,
    post.placement,
    post.instagramPostType,
    post.facebookPostType,
    accountEntry?.postType,
    accountEntry?.post_type,
    accountEntry?.type,
    accountEntry?.format,
    accountEntry?.contentType,
    accountEntry?.placement
  ].filter(Boolean);

  for (const rawFmt of formatCandidates) {
    const fmt = String(rawFmt).toLowerCase().trim();
    for (const banned of NON_POST_FORMAT_KEYWORDS) {
      const regex = new RegExp(`(^|[^a-z])${banned}([^a-z]|$)`, "i");
      if (regex.test(fmt)) {
        return false;
      }
    }
  }

  // 4. Check Facebook attachments media_type / type if present
  const attachments = post.attachments?.data;
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      const attType = `${att.type || ""} ${att.media_type || ""}`.toLowerCase();
      for (const banned of ["reel", "reels", "story", "stories", "short", "shorts", "live", "event"]) {
        const regex = new RegExp(`(^|[^a-z])${banned}([^a-z]|$)`, "i");
        if (regex.test(attType)) {
          return false;
        }
      }
    }
  }

  // 5. Check permalink / URL patterns (/stories/, /reel/, /reels/, /shorts/, /live/, /events/)
  // Note: Facebook feed permalinks often look like `https://www.facebook.com/story.php?story_fbid=...`,
  // which is a standard feed post, NOT `/stories/`.
  const urlCandidates = [
    post.permalink,
    post.permalink_url,
    post.link,
    post.url,
    accountEntry?.permalink,
    accountEntry?.url
  ].filter(Boolean);

  for (const rawUrl of urlCandidates) {
    const u = String(rawUrl).toLowerCase();
    if (
      u.includes("/stories/") ||
      (u.includes("/story/") && !u.includes("story.php")) ||
      u.includes("/reel/") ||
      u.includes("/reels/") ||
      u.includes("/shorts/") ||
      u.includes("/live/") ||
      u.includes("/events/")
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Normalizes post text for fuzzy matching between Pubblie and Meta Graph API.
 */
function normalizeTextForMatch(str = "") {
  return String(str || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts all candidate text from a Meta Graph API post (Facebook or Instagram).
 */
function extractMetaPostText(metaPost = {}) {
  const parts = [
    metaPost.message,
    metaPost.caption,
    metaPost.attachments?.data?.[0]?.description,
    metaPost.attachments?.data?.[0]?.title
  ].filter(Boolean);
  return parts.join(" ").trim();
}

/**
 * Finds the best matching published Meta post from a list of Facebook/Instagram posts.
 * Matches by:
 * 1. Exact permalink or Instagram shortcode
 * 2. Normalized text prefix/substring or significant word overlap (>= 60%)
 * 3. Scheduled/effective publication timestamp proximity (within +-90 minutes on the same page/account)
 */
function findMatchingMetaPost(metaPosts = [], target = {}) {
  if (!Array.isArray(metaPosts) || !metaPosts.length) return null;

  const targetPermalink = String(target.permalink || "").trim();
  const igShortcode = targetPermalink.match(/\/p\/([^\/\?]+)/)?.[1];
  const fbStoryFbid = targetPermalink.match(/story_fbid=([^&]+)/)?.[1];

  // 1. Permalink / shortcode match
  if (targetPermalink) {
    const byUrl = metaPosts.find(p => {
      const pUrl = String(p.permalink || p.permalink_url || "").trim();
      if (!pUrl) return false;
      if (pUrl === targetPermalink) return true;
      if (igShortcode && pUrl.includes(igShortcode)) return true;
      if (fbStoryFbid && (pUrl.includes(fbStoryFbid) || String(p.id || "").includes(fbStoryFbid))) return true;
      return false;
    });
    if (byUrl) return byUrl;
  }

  // 2. Normalized text match
  const normTarget = normalizeTextForMatch(target.postText || target.text || "");
  if (normTarget.length >= 6) {
    const targetPrefix = normTarget.slice(0, 35);
    const targetWords = normTarget.split(" ").filter(w => w.length >= 4);

    let bestTextMatch = null;
    let bestScore = 0;

    for (const p of metaPosts) {
      const normCandidate = normalizeTextForMatch(extractMetaPostText(p));
      if (!normCandidate) continue;

      const candPrefix = normCandidate.slice(0, 35);
      if (
        normCandidate === normTarget ||
        (targetPrefix.length >= 10 && normCandidate.includes(targetPrefix)) ||
        (candPrefix.length >= 10 && normTarget.includes(candPrefix))
      ) {
        return p;
      }

      if (targetWords.length >= 2) {
        const candWordSet = new Set(normCandidate.split(" ").filter(w => w.length >= 4));
        const shared = targetWords.filter(w => candWordSet.has(w)).length;
        const ratio = shared / targetWords.length;
        if (ratio >= 0.6 && ratio > bestScore) {
          bestScore = ratio;
          bestTextMatch = p;
        }
      }
    }

    if (bestTextMatch) return bestTextMatch;
  }

  // 3. Publication timestamp proximity match (within +-90 minutes of scheduled/effectiveDate)
  const rawDate = target.effectiveDate || target.publishedAt || target.scheduledAt;
  if (rawDate) {
    const targetMs = new Date(rawDate).getTime();
    // Only match by time if the scheduled time is in the past or within the next 5 minutes
    if (!isNaN(targetMs) && targetMs <= Date.now() + 5 * 60 * 1000) {
      const maxWindowMs = 90 * 60 * 1000; // 90 minutes
      let closestPost = null;
      let minDiff = Infinity;

      for (const p of metaPosts) {
        const pDateStr = p.created_time || p.timestamp || p.createdTime;
        if (!pDateStr) continue;
        const pMs = new Date(pDateStr).getTime();
        if (isNaN(pMs)) continue;

        const diff = Math.abs(pMs - targetMs);
        if (diff <= maxWindowMs && diff < minDiff) {
          minDiff = diff;
          closestPost = p;
        }
      }

      if (closestPost) return closestPost;
    }
  }

  return null;
}

/**
 * Filters and deduplicates Timeline Flow items so that:
 * - Only Facebook and Instagram items are kept
 * - Only standard "POST" format items are kept
 * - Duplicate cards for the same post on the same platform are eliminated
 */
function deduplicateTimelineItems(items = []) {
  const seenByRawPlatform = new Set();
  const seenByContentSignature = new Set();
  const result = [];

  for (const item of items) {
    if (!item || !item.isMetaCompatible) continue;
    if (item.platform !== "Facebook" && item.platform !== "Instagram") continue;
    if (item.postFormat && String(item.postFormat).toUpperCase() !== "POST") continue;

    const rawIdKey = `${item.projectId || ""}::${item.platform}::${item.rawId || item.id}`;
    if (seenByRawPlatform.has(rawIdKey)) {
      continue;
    }

    const dateMinute = item.effectiveDate ? new Date(item.effectiveDate).toISOString().slice(0, 16) : "";
    const normalizedText = String(item.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, 100);
    const channelKey = item.channelId || item.channelName || "";
    const contentSig = `${item.projectId || ""}::${item.platform}::${channelKey}::${dateMinute}::${normalizedText}`;

    if (normalizedText && seenByContentSignature.has(contentSig)) {
      continue;
    }

    seenByRawPlatform.add(rawIdKey);
    if (normalizedText) {
      seenByContentSignature.add(contentSig);
    }
    result.push(item);
  }

  return result;
}

module.exports = {
  detectMetaPlatform,
  isStandardPostFormat,
  normalizeTextForMatch,
  extractMetaPostText,
  findMatchingMetaPost,
  deduplicateTimelineItems
};
