const API_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const VALID_NAICS_PREFIXES = new Set([
  "11","21","22","23","31","32","33","42","44","45","48","49",
  "51","52","53","54","55","56","61","62","71","72","81","92"
]);

function clean(value, max = 240) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function dateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function yearsAgoISO(years) {
  const now = new Date();
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  return start.toISOString().slice(0, 10);
}

function locationLabel(value) {
  if (!value) return "";
  let loc = value;
  if (typeof loc === "string") {
    try { loc = JSON.parse(loc); } catch { return clean(loc, 120); }
  }
  if (typeof loc !== "object") return "";
  const city = clean(loc.city_name || loc.city || loc.cityName, 70);
  const state = clean(loc.state_name || loc.state || loc.stateName, 70);
  const country = clean(loc.country_name || loc.country || loc.countryName, 50);
  return [city, state, country].filter(Boolean).join(", ");
}

function awardDate(row) {
  return dateOnly(row["Base Obligation Date"] || row["Start Date"] || row["Last Modified Date"]);
}

function numericAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function recordLink(row) {
  const id = clean(row.generated_internal_id, 160);
  return id ? "https://www.usaspending.gov/award/" + encodeURIComponent(id) : "https://www.usaspending.gov/search";
}

export function normalizeNAICSSectors(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map(item => ({
    code: clean(item && item.code, 2),
    name: clean(item && item.name, 100),
    reason: clean(item && item.reason, 220)
  })).filter(item => {
    if (!VALID_NAICS_PREFIXES.has(item.code) || !item.name || seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  }).slice(0, 3);
}

export async function searchFederalAwardRecipients(sectors, options = {}) {
  const validSectors = normalizeNAICSSectors(sectors);
  if (!validSectors.length) {
    return { ok: false, error: "No valid NAICS sectors were identified for the product market.", candidates: [] };
  }
  const limitPerSector = Math.max(10, Math.min(40, Number(options.limitPerSector) || 25));
  const endDate = dateOnly(new Date());
  const startDate = yearsAgoISO(4);
  const grouped = new Map();
  const sectorErrors = [];

  for (const sector of validSectors) {
    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({
          subawards: false,
          limit: limitPerSector,
          page: 1,
          sort: "Last Modified Date",
          order: "desc",
          filters: {
            recipient_scope: "domestic",
            recipient_type_names: ["category_business"],
            award_type_codes: ["A", "B", "C", "D"],
            time_period: [{ start_date: startDate, end_date: endDate }],
            naics_codes: { require: [sector.code] }
          },
          fields: [
            "Award ID",
            "Recipient Name",
            "Recipient UEI",
            "recipient_id",
            "Recipient Location",
            "Description",
            "Start Date",
            "End Date",
            "Award Amount",
            "NAICS",
            "Base Obligation Date",
            "Last Modified Date",
            "generated_internal_id"
          ]
        })
      });
    } catch (error) {
      sectorErrors.push(sector.code + ": network request failed");
      continue;
    }
    if (!response.ok) {
      sectorErrors.push(sector.code + ": USAspending returned HTTP " + response.status);
      continue;
    }
    let payload;
    try { payload = await response.json(); }
    catch {
      sectorErrors.push(sector.code + ": response was not valid JSON");
      continue;
    }
    if (!Array.isArray(payload.results)) {
      sectorErrors.push(sector.code + ": response did not contain an awards list");
      continue;
    }

    for (const row of payload.results) {
      const name = clean(row["Recipient Name"], 180);
      if (!name) continue;
      const uei = clean(row["Recipient UEI"], 24);
      const recipientId = clean(row.recipient_id, 100);
      const key = (uei || recipientId || name.toLowerCase()).toLowerCase();
      const date = awardDate(row);
      const award = {
        awardId: clean(row["Award ID"], 100),
        description: clean(row.Description, 320),
        awardDate: date,
        amount: numericAmount(row["Award Amount"]),
        naics: clean(typeof row.NAICS === "string" ? row.NAICS : (row.NAICS && (row.NAICS.code || row.NAICS.naics_code || row.NAICS.description)) || "", 180),
        link: recordLink(row)
      };
      let company = grouped.get(key);
      if (!company) {
        company = {
          name,
          location: locationLabel(row["Recipient Location"]),
          uei,
          awardCount: 0,
          latestAwardDate: "",
          totalAwardValueInReturnedSample: 0,
          sectors: new Set(),
          awards: []
        };
        grouped.set(key, company);
      }
      company.awardCount += 1;
      company.totalAwardValueInReturnedSample += award.amount;
      company.sectors.add(sector.code + " — " + sector.name);
      if (date && (!company.latestAwardDate || date > company.latestAwardDate)) company.latestAwardDate = date;
      if (company.awards.length < 2) company.awards.push(award);
    }
  }

  const candidates = [...grouped.values()]
    .map(company => ({
      ...company,
      sectors: [...company.sectors],
      totalAwardValueInReturnedSample: Math.round(company.totalAwardValueInReturnedSample * 100) / 100,
      awards: company.awards.sort((a, b) => b.awardDate.localeCompare(a.awardDate))
    }))
    .sort((a, b) => b.awardCount - a.awardCount || b.latestAwardDate.localeCompare(a.latestAwardDate))
    .slice(0, 12);

  return {
    ok: candidates.length > 0,
    candidates,
    searchedSectors: validSectors,
    startDate,
    endDate,
    sectorErrors,
    sourceUrl: "https://www.usaspending.gov/"
  };
}

export function renderFederalAwardCandidates(result, productName) {
  if (!result || !result.ok || !Array.isArray(result.candidates) || !result.candidates.length) {
    const detail = Array.isArray(result && result.sectorErrors) && result.sectorErrors.length
      ? "\nSource issues: " + result.sectorErrors.join("; ")
      : "";
    return "🔎 USA FEDERAL CONTRACTOR DISCOVERY\nNo matching business recipients were returned for this product's mapped NAICS sectors." +
      detail + "\nTry /sales market ID to review the sector mapping. No contacts were collected and no email was sent.";
  }

  const lines = [
    "🔎 USA FEDERAL CONTRACTOR DISCOVERY",
    "Product: " + clean(productName, 160),
    "Source: USAspending.gov public federal award data",
    "Award period: " + result.startDate + " to " + result.endDate,
    "Mapped sectors: " + result.searchedSectors.map(item => item.code + " " + item.name).join("; "),
    "",
    "POTENTIAL ORGANIZATION MATCHES"
  ];
  for (let i = 0; i < result.candidates.length; i++) {
    const company = result.candidates[i];
    lines.push(
      "",
      (i + 1) + ". " + company.name,
      "Location: " + (company.location || "Not supplied in award result"),
      "Matching awards in returned sample: " + company.awardCount,
      "Most recent award date: " + (company.latestAwardDate || "Not supplied"),
      "Award evidence: " + (company.awards[0]?.description || "Description not supplied"),
      "Award ID: " + (company.awards[0]?.awardId || "Not supplied"),
      "Official record: " + (company.awards[0]?.link || result.sourceUrl),
      "Find official website: https://www.google.com/search?q=" + encodeURIComponent(company.name + " official website")
    );
  }
  if (result.sectorErrors && result.sectorErrors.length) {
    lines.push("", "Some sector requests did not complete: " + result.sectorErrors.join("; "));
  }
  lines.push(
    "",
    "IMPORTANT LIMITS",
    "These are organizations appearing as recipients of US federal contract awards in the selected NAICS sectors, not a complete list of US contractors. An award does not prove product need or buying intent, and this dataset may favor government contractors and larger firms.",
    "Company size and current business status are not verified. The awards sample is not total company revenue.",
    "",
    "NEXT STEP",
    "Review an organization's official website, then use /sales research PRODUCT_FILE_ID | Organization name | https://official-site.example for the existing product-fit check.",
    "This lookup collected organization-level award data only. It did not collect personal emails, add prospects to campaigns, or send email."
  );
  return lines.join("\n").slice(0, 3900);
}
