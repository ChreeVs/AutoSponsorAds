const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectMetaPlatform,
  isStandardPostFormat,
  findMatchingMetaPost,
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

test("isStandardPostFormat accepts standard POSTs (including Facebook shared_story and story.php) and rejects Stories, Reels, Shorts, and Live", () => {
  assert.equal(isStandardPostFormat({ id: "1", type: "POST", text: "Nuovo prodotto disponibile" }), true);
  assert.equal(isStandardPostFormat({ id: "2", media_product_type: "FEED", media_type: "IMAGE" }), true);
  assert.equal(isStandardPostFormat({ id: "3", media_product_type: "STORY", media_type: "IMAGE" }), false);
  assert.equal(isStandardPostFormat({ id: "4", media_product_type: "REELS", media_type: "VIDEO" }), false);
  assert.equal(isStandardPostFormat({ id: "5", postType: "STORY" }), false);
  assert.equal(isStandardPostFormat({ id: "6", format: "REEL" }), false);
  assert.equal(isStandardPostFormat({ id: "7", permalink: "https://www.instagram.com/reel/ABC123/" }), false);
  assert.equal(isStandardPostFormat({ id: "8", permalink: "https://www.instagram.com/stories/user/123/" }), false);
  assert.equal(isStandardPostFormat({ id: "9", permalink: "https://www.instagram.com/p/ABC123/" }), true);
  assert.equal(
    isStandardPostFormat({
      id: "865867900231234_999",
      status_type: "shared_story",
      permalink_url: "https://www.facebook.com/story.php?story_fbid=999&id=865867900231234"
    }),
    true
  );

  // Pubblie post detail where all Meta accounts have isStory: true (e.g. PAR daily car stories)
  assert.equal(
    isStandardPostFormat({
      id: "01a1ab51-044d-7774-a5eb-f52c6a6d0280",
      body: "Nissan Qashqai e-Power Acenta - noleggio a lungo termine",
      accounts: [
        { provider: "facebook", accountName: "Pulzoni Antonelli Rent", isStory: true, isReel: false },
        { provider: "instagram", accountName: "Pulzoni Antonelli | NLT", isStory: true, isReel: false }
      ]
    }),
    false
  );

  // Pubblie account with externalLink pointing to Instagram story
  assert.equal(
    isStandardPostFormat(
      { id: "01a1ab51", body: "Test story" },
      { provider: "instagram", isStory: false, externalLink: "https://www.instagram.com/stories/pulzoniantonellirent/4033056388968163961" }
    ),
    false
  );
});

test("findMatchingMetaPost matches published Facebook/Instagram posts by text, externalLink post ID, or scheduled timestamp proximity", () => {
  const fbPosts = [
    {
      id: "865867900231234_1817475883039213",
      message: "FIAT GRANDE PANDA - Grande Panda Benzina in promozione per tutti, anche senza un'auto da rottamare.",
      created_time: "2026-11-17T10:00:12+0000",
      permalink_url: "https://www.facebook.com/1662414255212044/posts/1817475883039213"
    },
    {
      id: "865867900231234_100",
      message: "Post precedente di ieri",
      created_time: "2026-11-16T09:00:00+0000"
    }
  ];

  // Match by Pubblie externalLink even when Facebook page vanity/delegate ID differs in URL
  const matchedByUrl = findMatchingMetaPost(fbPosts, {
    permalink: "https://www.facebook.com/1030530351733774/posts/1817475883039213",
    postText: ""
  });
  assert.equal(matchedByUrl?.id, "865867900231234_1817475883039213");

  // Match by normalized text (even with curly apostrophe vs straight apostrophe)
  const matchedByText = findMatchingMetaPost(fbPosts, {
    postText: "FIAT GRANDE PANDA\nGrande Panda Benzina in promozione per tutti, anche senza un’auto da rottamare."
  });
  assert.equal(matchedByText?.id, "865867900231234_1817475883039213");

  // Match by scheduled timestamp proximity (11:00 Europe/Rome = 10:00 UTC) even if text is empty
  const matchedByTime = findMatchingMetaPost(fbPosts, {
    postText: "",
    effectiveDate: "2026-11-17T10:00:00.000Z"
  });
  assert.equal(matchedByTime?.id, "865867900231234_1817475883039213");
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
  const winterMorningUtc = Date.parse("2026-11-17T10:00:00.000Z");
  assert.equal(
    new Date(AutomationEngine.getNextDaily1800RomeMs(winterMorningUtc)).toISOString(),
    "2026-11-17T17:00:00.000Z"
  );

  const winterEveningUtc = Date.parse("2026-11-17T17:30:00.000Z");
  assert.equal(
    new Date(AutomationEngine.getNextDaily1800RomeMs(winterEveningUtc)).toISOString(),
    "2026-11-18T17:00:00.000Z"
  );

  const summerMorningUtc = Date.parse("2026-07-15T10:00:00.000Z");
  assert.equal(
    new Date(AutomationEngine.getNextDaily1800RomeMs(summerMorningUtc)).toISOString(),
    "2026-07-15T16:00:00.000Z"
  );
});
