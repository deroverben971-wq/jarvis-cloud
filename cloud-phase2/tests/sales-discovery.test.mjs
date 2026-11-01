import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNAICSSectors,
  searchFederalAwardRecipients,
  renderFederalAwardCandidates
} from "../src/sales-discovery.mjs";

test("only accepts recognized US NAICS sector prefixes", () => {
  const sectors = normalizeNAICSSectors([
    { code: "23", name: "Construction" },
    { code: "999", name: "Made up sector" },
    { code: "23", name: "Duplicate construction" },
    { code: "54", name: "Professional services" }
  ]);
  assert.deepEqual(sectors.map(item => item.code), ["23", "54"]);
});

test("searches USAspending for domestic business contract recipients by NAICS", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.usaspending.gov/api/v2/search/spending_by_award/");
    assert.equal(options.method, "POST");
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        results: [{
          "Award ID": "TEST-123",
          "Recipient Name": "Example Construction LLC",
          "Recipient UEI": "ABC123456789",
          "recipient_id": "recipient-1",
          "Recipient Location": { city_name: "Dallas", state_name: "Texas", country_name: "United States" },
          "Description": "Building renovation work",
          "Base Obligation Date": "2025-06-01",
          "Award Amount": 125000,
          "NAICS": "236220 - Commercial and Institutional Building Construction",
          generated_internal_id: "CONT_AWD_TEST_123"
        }]
      })
    };
  };
  try {
    const result = await searchFederalAwardRecipients([{code:"23",name:"Construction"}]);
    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].name, "Example Construction LLC");
    assert.equal(result.candidates[0].location, "Dallas, Texas, United States");
    assert.equal(requestBody.filters.naics_codes.require[0], "23");
    assert.deepEqual(requestBody.filters.award_type_codes, ["A", "B", "C", "D"]);
    assert.equal(requestBody.filters.recipient_scope, "domestic");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rendered discovery report states its scope and has no email sending action", () => {
  const output = renderFederalAwardCandidates({
    ok: true,
    startDate: "2022-11-01",
    endDate: "2026-11-01",
    searchedSectors: [{code:"23",name:"Construction"}],
    sectorErrors: [],
    candidates: [{
      name: "Example Construction LLC",
      location: "Dallas, Texas",
      awardCount: 1,
      latestAwardDate: "2025-06-01",
      awards: [{description:"Building renovation",awardId:"TEST-123",link:"https://www.usaspending.gov/award/CONT_AWD_TEST_123"}]
    }]
  }, "Contractor Profit Control Center");
  assert.match(output, /USAspending\.gov/);
  assert.match(output, /does not prove product need or buying intent/);
  assert.match(output, /No email was sent/);
});

test("returns a safe notice when the product has no usable NAICS mapping", async () => {
  const result = await searchFederalAwardRecipients([{code:"999",name:"Invalid"}]);
  assert.equal(result.ok, false);
  assert.equal(result.candidates.length, 0);
});
