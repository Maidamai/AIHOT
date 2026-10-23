import {createHash} from "node:crypto";
export function noticeFixture(){
 const url='https://hyyyj.fujian.gov.cn/xxgk/tzgg/202507/t20250728_9999001.htm',pdfUrl=new URL('P0202507289999001.pdf',url).href,title='合成远洋资金政策明白纸';
 const listing=`<ul class="xw-list-1 gl_list"><li><a href="${url}">${title}</a></li></ul>`;
 const landing=(link=pdfUrl)=>`<meta name="ArticleTitle" content="${title}"><meta name="PubDate" content="2025-07-29 10:20"><div id="detailCont"><div class="TRS_Editor">${title}</div></div><ul class="myzj_xl_list"><li><a href="${link}">政策附件.pdf</a></li></ul>`;
 const pdf=Buffer.from('%PDF-synthetic-notice-only'),text='--- Page 1 ---\n合成远洋渔业资金政策全文。\n--- Page 2 ---\n完整末页，不证明补贴开放或政策现行有效。';
 const parsePdf=async(bytes:Buffer)=>({status:'parsed' as const,rawSha256:createHash('sha256').update(bytes).digest('hex'),parser:'synthetic-notice/v1',pages:2,text});
 return {url,pdfUrl,title,listing,landing,pdf,text,parsePdf};
}
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

export function pdfFixture(blank = false, encrypted = false, text = "Synthetic fishery evidence"): Buffer {
  const md5 = (b: Buffer) => createHash("md5").update(b).digest();
  const rc4 = (key: Buffer, input: Buffer) => {
    const s = Array.from({ length: 256 }, (_, i) => i); let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; }
    let i = 0; j = 0;
    return Buffer.from(input.map(v => { i = (i + 1) % 256; j = (j + s[i]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; return v ^ s[(s[i]! + s[j]!) % 256]!; }));
  };
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const pad = (s: string) => Buffer.concat([Buffer.from(s), padding]).subarray(0, 32);
  const id = md5(Buffer.from("synthetic-fishery-test")), p = Buffer.alloc(4); p.writeInt32LE(-4);
  const owner = rc4(md5(pad("fixture-owner")).subarray(0, 5), pad("fixture-user"));
  const key = md5(Buffer.concat([pad("fixture-user"), owner, p, id])).subarray(0, 5);
  let content = Buffer.from(blank ? "" : `BT /F1 12 Tf 40 100 Td (${text}) Tj ET`);
  if (encrypted) content = rc4(md5(Buffer.concat([key, Buffer.from([5, 0, 0, 0, 0])])).subarray(0, 10), content);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [4 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]),
  ];
  if (encrypted) objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${rc4(key, padding).toString("hex")}> /P -4 >>`));
  const chunks = [Buffer.from("%PDF-1.4\n")], offsets = [0]; let size = chunks[0]!.length;
  objects.forEach((body, i) => { offsets.push(size); const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]); chunks.push(chunk); size += chunk.length; });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt 6 0 R /ID [<${id.toString("hex")}><${id.toString("hex")}>]` : ""} >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
