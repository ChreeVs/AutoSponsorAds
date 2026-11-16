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
