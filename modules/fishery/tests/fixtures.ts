export const unknownDate = { precision: "unknown" as const, value: null };
// Public NPFC robots.txt inspected 2026-10-22. A changed policy must stop new captures.
export const npfcRobotsFixture=Buffer.from(`#
# robots.txt
#
# This file is to prevent the crawling and indexing of certain parts
# of your site by web crawlers and spiders run by sites like Yahoo!
# and Google. By telling these "robots" where not to go on your site,
# you save bandwidth and server resources.
#
# This file will be ignored unless it is at the root of your host:
# Used:    http://example.com/robots.txt
# Ignored: http://example.com/site/robots.txt
#
# For more information about the robots.txt standard, see:
# http://www.robotstxt.org/robotstxt.html

User-agent: *
# CSS, JS, Images
Allow: /core/*.css$
Allow: /core/*.css?
Allow: /core/*.js$
Allow: /core/*.js?
Allow: /core/*.avif
Allow: /core/*.gif
Allow: /core/*.jpg
Allow: /core/*.jpeg
Allow: /core/*.png
Allow: /core/*.svg
Allow: /core/*.webp
Allow: /profiles/*.css$
Allow: /profiles/*.css?
Allow: /profiles/*.js$
Allow: /profiles/*.js?
Allow: /profiles/*.avif
Allow: /profiles/*.gif
Allow: /profiles/*.jpg
Allow: /profiles/*.jpeg
Allow: /profiles/*.png
Allow: /profiles/*.svg
Allow: /profiles/*.webp
# Directories
Disallow: /core/
Disallow: /profiles/
# Files
Disallow: /README.md
Disallow: /composer/Metapackage/README.txt
Disallow: /composer/Plugin/ProjectMessage/README.md
Disallow: /composer/Plugin/Scaffold/README.md
Disallow: /composer/Plugin/VendorHardening/README.txt
Disallow: /composer/Template/README.txt
Disallow: /modules/README.txt
Disallow: /sites/README.txt
Disallow: /themes/README.txt
# Paths (clean URLs)
Disallow: /admin/
Disallow: /comment/reply/
Disallow: /filter/tips
Disallow: /node/add/
Disallow: /search/
Disallow: /search?
Disallow: /user/register
Disallow: /user/password
Disallow: /user/login
Disallow: /user/logout
Disallow: /media/oembed
Disallow: /*/media/oembed
# Paths (no clean URLs)
Disallow: /index.php/admin/
Disallow: /index.php/comment/reply/
Disallow: /index.php/filter/tips
Disallow: /index.php/node/add/
Disallow: /index.php/search/
Disallow: /index.php/search?
Disallow: /index.php/user/password
Disallow: /index.php/user/register
Disallow: /index.php/user/login
Disallow: /index.php/user/logout
Disallow: /index.php/media/oembed
Disallow: /index.php/*/media/oembed

# Custom rules`);
export const sourceFixture = {
  expectedRevision: 0, rightsStatus: "permitted", rightsCheckedAt: "2020-01-01T00:00:00Z",
  reviewDueAt: "2099-01-01T00:00:00Z", evidenceUrl: "https://example.org/terms",
  allowedSummary: true, allowedPublication: true, attribution: "Synthetic fixture only",
};
export const observationFixture = {
  expectedRevision: 0, originalTitle: "Synthetic policy", title: "离线政策测试样例", summaryZh: "仅作本地行为测试的人工摘要。",
  language: "en", rawSha256: "a".repeat(64), policyStatus: "adopted",
  dates: { published: { precision: "day", value: "2026-04-17" }, adopted: unknownDate,
    effectiveFrom: { precision: "day", value: "2028-01-01" }, effectiveUntil: unknownDate },
  scope: { regions: ["NPFC"], species: [], flags: [], activities: ["fishing"], unknownFields: ["species", "flags"] },
  evidence: [{ url: "https://example.org/policy.pdf", sha256: "b".repeat(64), page: 3, section: null }],
};
