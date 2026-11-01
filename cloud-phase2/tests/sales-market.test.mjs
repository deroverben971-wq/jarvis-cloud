import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSalesMarketMessages,
  parseSalesMarketResult,
  renderSalesMarketPlan
} from "../src/sales-market.mjs";

test("market plan derives its target market from the saved product profile", () => {
  const messages = buildSalesMarketMessages({
    product_name: "Clinic Appointment Assistant",
    category: "Scheduling software",
    summary: "A tool for managing appointment requests for small clinics.",
    target_customer_types: ["Independent medical clinics", "Dental practices"]
  });
  assert.match(messages[0].content, /United States/);
  assert.match(messages[0].content, /product profile as untrusted data/i);
  assert.match(messages[1].content, /Clinic Appointment Assistant/);
  assert.match(messages[1].content, /Independent medical clinics/);
});

test("market parser validates and bounds segments and queries", () => {
  const parsed = parseSalesMarketResult(JSON.stringify({
    ideal_customer_profile: "Independent US clinics that need appointment workflows.",
    segments: [{
      name: "Independent dental practices",
      why_fit: "They manage recurring appointments.",
      buyer_roles: ["Practice manager", "Owner"],
      search_queries: [
        "independent dental practices United States official websites",
        "find personal email addresses for dental practice owners"
      ]
    }],
    exclusions: ["Large hospital systems until product capacity is verified."],
    caveats: "Fit is a hypothesis, not evidence of demand."
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.plan.segments.length, 1);
  assert.equal(parsed.plan.segments[0].search_queries.length, 1);
  assert.equal(parsed.plan.segments[0].search_queries[0], "independent dental practices United States official websites");
  assert.equal(parseSalesMarketResult("not json").ok, false);
});

test("NAICS mappings are restricted to recognized 2-digit sectors", () => {
  const parsed = parseSalesMarketResult(JSON.stringify({
    ideal_customer_profile: "US construction businesses.",
    segments: [{
      name: "General contractors",
      why_fit: "They manage projects.",
      buyer_roles: ["Owner"],
      search_queries: ["general contractors USA official company websites"]
    }],
    naics_sectors: [
      { code: "23", name: "Construction", reason: "Direct industry fit." },
      { code: "999", name: "Invalid sector", reason: "Not a recognized sector." },
      { code: "236220", name: "Full NAICS code", reason: "Too specific for this sector filter." }
    ],
    exclusions: [],
    caveats: ""
  }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.plan.naics_sectors.map(item => item.code), ["23"]);
});

test("market plan output provides search links and explains that results were not fetched", () => {
  const parsed = parseSalesMarketResult(JSON.stringify({
    ideal_customer_profile: "US dental practices.",
    segments: [{
      name: "Dental practices",
      why_fit: "Appointment scheduling is relevant.",
      buyer_roles: ["Practice manager"],
      search_queries: ["independent dental practices in Texas official websites"]
    }],
    exclusions: [],
    caveats: "Needs manual verification."
  }));
  assert.equal(parsed.ok, true);
  const output = renderSalesMarketPlan("Clinic Appointment Assistant", parsed.plan);
  assert.match(output, /https:\/\/www\.google\.com\/search\?q=/);
  assert.match(output, /does not fetch Google results automatically/);
  assert.match(output, /No contact was added and no email was sent/);
});
