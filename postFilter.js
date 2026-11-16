/**
 * Pure filtering and deduplication utilities for AutoSponsorAds.
 * Ensures:
 * 1. Only Facebook and Instagram channels are treated as Meta-compatible.
 * 2. Only standard "POST" format items are included/sponsored (excluding Stories, Reels, Shorts, Live, Events).
 * 3. Duplicate posts across channels or repeated API entries are deduplicated in Timeline Flow.
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
    post.status_type,
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
      for (const banned of NON_POST_FORMAT_KEYWORDS) {
        const regex = new RegExp(`(^|[^a-z])${banned}([^a-z]|$)`, "i");
        if (regex.test(attType)) {
          return false;
        }
      }
    }
  }

  // 5. Check permalink / URL patterns (/stories/, /reel/, /reels/, /shorts/, /live/, /events/)
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
      u.includes("/story/") ||
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
  deduplicateTimelineItems
};
