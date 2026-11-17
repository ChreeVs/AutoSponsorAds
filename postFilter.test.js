const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectMetaPlatform,
  isStandardPostFormat,
  deduplicateTimelineItems
} = require("./postFilter");

test("detectMetaPlatform identifies only Facebook and Instagram and rejects external channels", () => {
  assert.equal(detectMetaPlatform("facebook", "Pagina Ufficiale"), "Facebook");
  assert.equal(detectMetaPlatform("instagram-direct", "Profilo IG"), "Instagram");
  assert.equal(detectMetaPlatform("tiktok", "Account TikTok"), null);
  assert.equal(detectMetaPlatform("linkedin", "Company Page"), null);
  assert.equal(detectMetaPlatform("google-business", "Scheda GMB"), null);
  assert.equal(detectMetaPlatform("youtube", "Canale YouTube"), null);
  assert.equal(detectMetaPlatform("meta", "TikTok Italia"), null);
});

test("isStandardPostFormat accepts standard POSTs and rejects Stories, Reels, Shorts, and Live", () => {
  assert.equal(isStandardPostFormat({ id: "1", type: "POST", text: "Nuovo prodotto disponibile" }), true);
  assert.equal(isStandardPostFormat({ id: "2", media_product_type: "FEED", media_type: "IMAGE" }), true);
  assert.equal(isStandardPostFormat({ id: "3", media_product_type: "STORY", media_type: "IMAGE" }), false);
  assert.equal(isStandardPostFormat({ id: "4", media_product_type: "REELS", media_type: "VIDEO" }), false);
  assert.equal(isStandardPostFormat({ id: "5", postType: "STORY" }), false);
  assert.equal(isStandardPostFormat({ id: "6", format: "REEL" }), false);
  assert.equal(isStandardPostFormat({ id: "7", permalink: "https://www.instagram.com/reel/ABC123/" }), false);
  assert.equal(isStandardPostFormat({ id: "8", permalink: "https://www.instagram.com/stories/user/123/" }), false);
  assert.equal(isStandardPostFormat({ id: "9", permalink: "https://www.instagram.com/p/ABC123/" }), true);
});

test("deduplicateTimelineItems removes duplicate posts and non-Meta items", () => {
  const input = [
    {
      id: "pub_100_fb",
      rawId: "100",
      projectId: "p1",
      platform: "Facebook",
      isMetaCompatible: true,
      postFormat: "POST",
      channelId: "ch_fb",
      effectiveDate: "2026-11-16T10:00:00.000Z",
      text: "Offerta lancio autunno"
    },
    {
      id: "pub_100_fb_dup",
      rawId: "100",
      projectId: "p1",
      platform: "Facebook",
      isMetaCompatible: true,
      postFormat: "POST",
      channelId: "ch_fb",
      effectiveDate: "2026-11-16T10:00:00.000Z",
      text: "Offerta lancio autunno"
    },
    {
      id: "pub_100_ig",
      rawId: "100",
      projectId: "p1",
      platform: "Instagram",
      isMetaCompatible: true,
      postFormat: "POST",
      channelId: "ch_ig",
      effectiveDate: "2026-11-16T10:00:00.000Z",
      text: "Offerta lancio autunno"
    },
    {
      id: "pub_100_tiktok",
      rawId: "100",
      projectId: "p1",
      platform: "TikTok",
      isMetaCompatible: false,
      postFormat: "POST",
      channelId: "ch_tt",
      effectiveDate: "2026-11-16T10:00:00.000Z",
      text: "Offerta lancio autunno"
    }
  ];

  const deduped = deduplicateTimelineItems(input);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map(i => i.platform), ["Facebook", "Instagram"]);
});

test("AutomationEngine.getNextDaily1800RomeMs computes next 18:00 Europe/Rome across CET and CEST", () => {
  const AutomationEngine = require("./automationEngine");
  // Winter (CET = UTC+1): 10:00 UTC is 11:00 Rome -> next 18:00 Rome is today at 17:00 UTC
  const winterMorningUtc = Date.parse("2026-11-17T10:00:00.000Z");
  assert.equal(
    new Date(AutomationEngine.getNextDaily1800RomeMs(winterMorningUtc)).toISOString(),
    "2026-11-17T17:00:00.000Z"
  );

  // Winter (CET = UTC+1): 17:30 UTC is 18:30 Rome -> next 18:00 Rome is tomorrow at 17:00 UTC
  const winterEveningUtc = Date.parse("2026-11-17T17:30:00.000Z");
  assert.equal(
    new Date(AutomationEngine.getNextDaily1800RomeMs(winterEveningUtc)).toISOString(),
    "2026-11-18T17:00:00.000Z"
  );

  // Summer (CEST = UTC+2): 10:00 UTC is 12:00 Rome -> next 18:00 Rome is today at 16:00 UTC
  const summerMorningUtc = Date.parse("2026-07-15T10:00:00.000Z");
  assert.equal(
    new Date(AutomationEngine.getNextDaily1800RomeMs(summerMorningUtc)).toISOString(),
    "2026-07-15T16:00:00.000Z"
  );
});

