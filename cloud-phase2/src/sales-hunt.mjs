import { validateResearchRequest } from "./sales-research.mjs";

const DIRECTORY_URL = "https://companies.directory/api/public/country/united-states/rows";
const DIRECTORY_SOURCE = "https://companies.directory/sources";
const MAX_RETURNED = 25;

const BLOCKED_HOSTS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com",
  "youtube.com", "tiktok.com", "yelp.com", "yellowpages.com", "mapquest.com",
  "google.com", "bbb.org", "angi.com", "homeadvisor.com", "thumbtack.com",
  "houzz.com", "buildzoom.com"
]);

function clean(value, max = 180) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function isBlockedHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  for (const blocked of BLOCKED_HOSTS) {
    if (host === blocked || host.endsWith("." + blocked)) return true;
  }
  return false;
}

function normalizeWebsite(value) {
  let raw = clean(value, 500);
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.protocol === "http:" && !url.port) url.protocol = "https:";
    if (url.port && url.port !== "443") return "";
    if (url.username || url.password) return "";
    url.search = "";
    url.hash = "";
    url.pathname = "/";
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * Fetch a small set of US construction-company records from the provider's
 * no-key public directory endpoint. Only organization name, location, and
 * website are copied from each row. Any email/phone/contact fields returned
 * by the provider are intentionally ignored.
 */
export async function searchUSConstructionCompanies(options = {}) {
  const limit = Math.max(1, Math.min(10, Number(options.limit) || 5));
  const url = new URL(DIRECTORY_URL);
  url.searchParams.set("industry", "Construction");
  url.searchParams.set("has_website", "1");
  url.searchParams.set("sort", "coverage");

  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { "accept": "application/json" }
    });
  } catch {
    return {
      ok: false,
      error: "The company directory could not be reached.",
      candidates: [],
      sourceUrl: DIRECTORY_SOURCE
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: "The company directory returned HTTP " + response.status + ".",
      candidates: [],
      sourceUrl: DIRECTORY_SOURCE
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      error: "The company directory response was not valid JSON.",
      candidates: [],
      sourceUrl: DIRECTORY_SOURCE
    };
  }

  if (!payload || !Array.isArray(payload.rows)) {
    return {
      ok: false,
      error: "The company directory response did not contain a rows array.",
      candidates: [],
      sourceUrl: DIRECTORY_SOURCE
    };
  }

  const seen = new Set();
  const candidates = [];
  for (const row of payload.rows.slice(0, MAX_RETURNED)) {
    const name = clean(row && row.name);
    const website = normalizeWebsite(row && row.website);
    if (!name || !website) continue;
    const checked = validateResearchRequest(name, website);
    if (!checked.ok || isBlockedHost(checked.hostname)) continue;
    const hostname = checked.hostname.replace(/^www\\./i, "");
    if (seen.has(hostname)) continue;
    seen.add(hostname);
    const locality = clean(row.locality, 80);
    const region = clean(row.region, 80);
    candidates.push({
      name: checked.prospectName,
      websiteUrl: "https://" + hostname + "/",
      hostname,
      location: [locality, region, "United States"].filter(Boolean).join(", ")
    });
    if (candidates.length >= limit) break;
  }

  return {
    ok: true,
    candidates,
    total: typeof payload.total === "number" && Number.isFinite(payload.total) ? payload.total : null,
    sourceUrl: DIRECTORY_SOURCE,
    queryUrl: url.toString()
  };
}
