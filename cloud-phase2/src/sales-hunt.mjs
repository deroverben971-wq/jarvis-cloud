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
async function searchCompaniesDirectory(options = {}) {
  const limit = Math.max(1, Math.min(10, Number(options.limit) || 5));
  const url = new URL(DIRECTORY_URL);
  url.searchParams.set("industry", "Construction");
  url.searchParams.set("has_website", "1");
  url.searchParams.set("sort", "coverage");

  let response;
  let networkFailure = false;
  let attempts = 0;
  const retryableStatuses = new Set([429, 500, 502, 503, 504, 520, 522, 523, 524, 525]);

  for (let attempt = 0; attempt < 3; attempt++) {
    attempts = attempt + 1;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: { "accept": "application/json" }
      });
      networkFailure = false;
    } catch {
      networkFailure = true;
      if (attempt === 2) break;
    }

    if (!networkFailure && response && (response.ok || !retryableStatuses.has(response.status))) break;
    if (attempt === 2) break;

    let delayMs = attempt === 0 ? 600 : 1600;
    if (!networkFailure && response) {
      const retryAfter = String(response.headers?.get?.("retry-after") || "").trim();
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const retryAt = Number.isFinite(seconds)
          ? Date.now() + Math.max(0, seconds) * 1000
          : Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) {
          delayMs = Math.min(3000, Math.max(250, retryAt - Date.now()));
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  if (networkFailure || !response) {
    return {
      ok: false,
      error: "The company directory could not be reached after " + attempts + " attempts.",
      candidates: [],
      sourceUrl: DIRECTORY_SOURCE,
      attempts
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: "The company directory returned HTTP " + response.status + " after " + attempts + " attempts.",
      candidates: [],
      sourceUrl: DIRECTORY_SOURCE,
      attempts
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
    const hostname = checked.hostname.replace(/^www\./i, "");
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
    queryUrl: url.toString(),
    attempts
  };
}


const PROFIX_TOP_URL = "https://profixdirectory.com/api/pros.json";
const PROFIX_CSV_URL = "https://profixdirectory.com/api/pros.csv";
const PROFIX_SOURCE = "https://profixdirectory.com/open-data";
const PROFIX_PROFILE_BASE = "https://profixdirectory.com/pro/";
const OHIO_CONSTRUCTION_TRADES = new Set([
  "plumber", "hvac", "electrician", "concrete", "roofing",
  "restoration", "lead-abatement", "fire-protection",
  "water-well", "septic-system", "gas-tech"
]);

function parseCsvRecords(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const csv = String(input || "").replace(/^\\uFEFF/, "");

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    if (row.some(value => value !== "")) rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows.shift().map(value => clean(value, 80).toLowerCase());
  return rows.map(values => {
    const record = {};
    for (let i = 0; i < headers.length; i++) {
      if (headers[i]) record[headers[i]] = values[i] ?? "";
    }
    return record;
  });
}

function extractProFixRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.record)) return payload.record;
  if (Array.isArray(payload.pros)) return payload.pros;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.records)) return payload.records;
  if (payload.data && Array.isArray(payload.data)) return payload.data;
  if (payload.data && Array.isArray(payload.data.pros)) return payload.data.pros;
  return [];
}

function normalizeTradeList(value) {
  if (Array.isArray(value)) return value.map(item => clean(item, 50).toLowerCase()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(item => clean(item, 50).toLowerCase()).filter(Boolean);
  } catch {
    // Some CSV mirrors may encode trades as a plain delimited string.
  }
  return value.split(/[;,|]/).map(item => clean(item, 50).toLowerCase()).filter(Boolean);
}

/**
 * Use ProFix's documented compact JSON feed first and its documented CSV
 * export second. The previous Hugging Face filename returned HTTP 404 in the
 * deployed Worker, while /api/all.json was intermittently rate-limited.
 * Only Ohio construction-relevant records with public business websites are
 * returned. Public phone and email fields are intentionally ignored.
 */
export async function searchProFixOhioContractors(options = {}) {
  const limit = Math.max(1, Math.min(10, Number(options.limit) || 5));
  const sources = [
    { url: PROFIX_TOP_URL, label: "ProFix compact JSON feed", format: "json" },
    { url: PROFIX_CSV_URL, label: "ProFix CSV export", format: "csv" }
  ];
  const sourceErrors = [];

  for (const source of sources) {
    let response;
    try {
      response = await fetch(source.url, {
        method: "GET",
        headers: { "accept": source.format === "csv" ? "text/csv" : "application/json" }
      });
    } catch {
      sourceErrors.push(source.label + " could not be reached");
      continue;
    }

    if (!response.ok) {
      sourceErrors.push(source.label + " returned HTTP " + response.status);
      continue;
    }

    let records = [];
    let payload = {};
    try {
      if (source.format === "csv") {
        records = parseCsvRecords(await response.text());
      } else {
        payload = await response.json();
        records = extractProFixRecords(payload);
      }
    } catch {
      sourceErrors.push(source.label + " returned unreadable data");
      continue;
    }

    if (!records.length) {
      sourceErrors.push(source.label + " contained no contractor records in a recognized format");
      continue;
    }

    const seen = new Set();
    const candidates = [];
    for (const row of records) {
      if (!row || String(row.state || payload.coverage_state || "").toUpperCase() !== "OH") continue;
      const tradeList = normalizeTradeList(row.trades)
        .filter(value => OHIO_CONSTRUCTION_TRADES.has(value));
      if (!tradeList.length) continue;

      const name = clean(row.name, 180);
      const website = normalizeWebsite(row.website_url || row.website);
      if (!name || !website) continue;
      const checked = validateResearchRequest(name, website);
      if (!checked.ok || isBlockedHost(checked.hostname)) continue;

      const hostname = checked.hostname.replace(/^www\./i, "");
      if (seen.has(hostname)) continue;
      seen.add(hostname);
      const city = clean(row.city, 80);
      const county = clean(row.county, 80);
      const slug = clean(row.slug, 140);
      candidates.push({
        name: checked.prospectName,
        websiteUrl: "https://" + hostname + "/",
        hostname,
        location: [city, county, "Ohio, United States"].filter(Boolean).join(", "),
        trades: tradeList,
        verificationTier: clean(row.verification_tier, 50) || "Not supplied",
        profileUrl: slug ? PROFIX_PROFILE_BASE + encodeURIComponent(slug) : PROFIX_SOURCE
      });
      if (candidates.length >= limit) break;
    }

    if (!candidates.length) {
      sourceErrors.push(source.label + " had no matching Ohio contractor records with public websites");
      continue;
    }

    const total = Number(payload.record_count ?? payload.total);
    return {
      ok: true,
      candidates,
      total: Number.isFinite(total) && total > 0 ? total : records.length,
      sourceLabel: source.label === "ProFix compact JSON feed"
        ? "ProFix Directory (Ohio) — compact JSON feed"
        : "ProFix Directory (Ohio) — CSV export",
      sourceUrl: PROFIX_SOURCE,
      dataUrl: source.url,
      scopeLabel: "Ohio only",
      snapshotVersion: clean(payload.version, 30),
      generatedAt: clean(payload.generated_at, 40),
      attribution: "Data: ProFix Directory, CC-BY-4.0"
    };
  }

  return {
    ok: false,
    error: sourceErrors.join("; ") || "No ProFix Ohio source could be read.",
    candidates: [],
    sourceLabel: "ProFix Directory (Ohio)",
    sourceUrl: PROFIX_SOURCE,
    scopeLabel: "Ohio only"
  };
}

/**
 * Try the nationwide public directory first. If it is unavailable or returns
 * no usable websites, fall back to the narrower, explicitly Ohio-only public
 * contractor dataset. Never present the fallback as nationwide coverage.
 */
export async function searchUSConstructionCompanies(options = {}) {
  const primary = await searchCompaniesDirectory(options);
  if (primary.ok && primary.candidates.length) {
    return {
      ...primary,
      sourceLabel: "companies.directory — US",
      scopeLabel: "United States; provider coverage may be incomplete"
    };
  }

  const fallback = await searchProFixOhioContractors(options);
  if (fallback.ok && fallback.candidates.length) {
    return {
      ...fallback,
      fallbackReason: primary.error || "Nationwide source returned no usable company websites."
    };
  }

  const primaryIssue = primary.error || "The nationwide directory returned no usable company websites.";
  const fallbackIssue = fallback.error || "No usable Ohio contractor websites were returned.";
  return {
    ok: false,
    candidates: [],
    error: primaryIssue + " Ohio fallback: " + fallbackIssue,
    sourceLabel: "No directory source available",
    sourceUrl: fallback.sourceUrl || primary.sourceUrl || DIRECTORY_SOURCE,
    scopeLabel: "No results verified"
  };
}
