const BLOCKED_HOSTS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "youtube.com", "tiktok.com",
  "x.com", "twitter.com", "pinterest.com", "reddit.com", "yelp.com",
  "yellowpages.com", "bbb.org", "mapquest.com"
]);

function clean(value, max = 220) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function isBlockedHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  return [...BLOCKED_HOSTS].some(domain => host === domain || host.endsWith("." + domain));
}

export function buildProspectDiscoveryQueries(productProfile, region = "United States") {
  const profile = productProfile && typeof productProfile === "object" ? productProfile : {};
  const area = clean(region || "United States", 80) || "United States";
  const types = Array.isArray(profile.target_customer_types)
    ? profile.target_customer_types.map(item => clean(item, 100)).filter(Boolean).slice(0, 4) : [];
  if (!types.length) return [];
  const problems = Array.isArray(profile.problems_solved)
    ? profile.problems_solved.map(item => clean(item, 90)).filter(Boolean).slice(0, 2) : [];
  return types.slice(0, 3).map((type, index) => {
    const problem = problems[index % Math.max(1, problems.length)] || "";
    return [type, problem, area, "professional services website"].filter(Boolean).join(" ");
  });
}

export function parseDiscoveryResults(payload, limit = 8) {
  let results = [];
  if (Array.isArray(payload)) results = payload;
  else if (payload && Array.isArray(payload.results)) results = payload.results;
  else if (payload && Array.isArray(payload.data)) results = payload.data;
  const seen = new Set();
  const out = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const rawUrl = item.url || item.link || item.result_url || item.target_url || "";
    let url;
    try { url = new URL(String(rawUrl)); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) continue;
    if (!url.hostname.includes(".") || isBlockedHost(url.hostname)) continue;
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    const value = url.toString();
    if (seen.has(value)) continue;
    seen.add(value);
    const title = clean(item.title || item.name || item.display_title || url.hostname, 140);
    const snippet = clean(item.content || item.extract || item.snippet || item.description || "", 360);
    out.push({ prospectName: title, websiteUrl: value, snippet, sourceTitle: title });
    if (out.length >= Math.max(1, Math.min(15, Number(limit) || 8))) break;
  }
  return out;
}
