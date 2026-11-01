import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSalesResearchMessages, discoverResearchPages, extractResearchPage,
  parseSalesResearchResult, validateResearchRequest
} from "../src/sales-research.mjs";

test("research requests accept individual professionals and organizations with public HTTPS websites", () => {
  assert.equal(validateResearchRequest("Alex Rivera, Independent Contractor", "https://alex.example").ok, true);
  assert.equal(validateResearchRequest("Acme Construction", "https://acme.example").ok, true);
  assert.equal(validateResearchRequest("", "https://acme.example").ok, false);
  assert.equal(validateResearchRequest("Acme", "http://acme.example").ok, false);
  assert.equal(validateResearchRequest("Acme", "https://localhost").ok, false);
  assert.equal(validateResearchRequest("Acme", "https://127.0.0.1").ok, false);
  assert.equal(validateResearchRequest("Acme", "https://user:pass@acme.example").ok, false);
  assert.equal(validateResearchRequest("Acme", "https://acme.example:8443").ok, false);
});

test("research URL removes search and fragment", () => {
  const result = validateResearchRequest("Alex Rivera", "https://alex.example/about?utm_source=x#profile");
  assert.equal(result.ok, true);
  assert.equal(result.websiteUrl, "https://alex.example/about");
});

test("HTML extraction omits scripts and returns only same-domain role inboxes", () => {
  const html = "<html><head><title>Alex Rivera</title><script>secret@example.com</script></head>" +
    "<body><h1>Independent construction consultant</h1><p>Project management.</p>" +
    "<a href=\"/contact\">Contact</a><a href=\"https://other.example/contact\">Other</a>" +
    "<p>Contact info@alex.example or Jane at jane@alex.example.</p>" +
    "<p>sales@alex.example and info@other.example</p><footer>footer@example.com</footer></body></html>";
  const result = extractResearchPage(html, "https://alex.example/", "alex.example");
  assert.equal(result.title, "Alex Rivera");
  assert.match(result.text, /Independent construction consultant/);
  assert.doesNotMatch(result.text, /secret@example.com/);
  assert.deepEqual(result.emails.map(item => item.email), ["info@alex.example", "sales@alex.example"]);
  assert.equal(result.emails[0].permissionStatus, "public_contact_only");
  assert.equal(result.links.length, 1);
});

test("research page discovery accepts only same-origin relevant links", () => {
  const links = [
    { url: "https://acme.example/contact" }, { url: "https://acme.example/about-us" },
    { url: "https://evil.example/contact" }, { url: "http://acme.example/services" },
    { url: "https://acme.example/random" }
  ];
  assert.deepEqual(discoverResearchPages(links, "https://acme.example/", 2),
    ["https://acme.example/contact", "https://acme.example/about-us"]);
});

test("research prompt is driven by the selected product target market", () => {
  const messages = buildSalesResearchMessages("Alex Rivera", "https://alex.example/", {
    product_name: "Creator Content Calendar",
    target_customer_types: ["Independent creators", "Freelance social-media managers"],
    problems_solved: ["Planning and scheduling content"]
  }, [
    { sourceUrl: "https://alex.example/", title: "Alex", text: "Independent content strategist." }
  ]);
  assert.match(messages[0].content, /individual professional/);
  assert.match(messages[1].content, /selected digital product's target market/);
  assert.match(messages[1].content, /Independent creators/);
  assert.match(messages[1].content, /Creator Content Calendar/);
  assert.doesNotMatch(messages[1].content, /Contractor Profit Control Center/);
});

test("research output strips invalid source URLs and bounds fields", () => {
  const parsed = parseSalesResearchResult(JSON.stringify({
    prospect_type: "individual_professional", fit_score: 87,
    fit_rationale: "The prospect's public profile indicates relevant consulting work.",
    business_summary: "An independent construction consultant", services: ["Consulting", "  "],
    customer_types: ["Contractors"],
    fit_signals: [
      { evidence: "The person provides project-management services.", source_url: "https://alex.example/services" },
      { evidence: "Unsupported source", source_url: "javascript:alert(1)" }
    ],
    missing_information: ["Budget"], confidence: "high"
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.profile.fit_signals.length, 1);
  assert.equal(parsed.profile.prospect_type, "individual_professional");
  assert.equal(parsed.profile.fit_score, 87);
  assert.equal(parsed.profile.confidence, "high");
  assert.equal(parseSalesResearchResult("not json").ok, false);
});
