import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSalesResearchMessages, discoverResearchPages, extractResearchPage,
  parseSalesResearchResult, validateResearchRequest
} from "../src/sales-research.mjs";

test("research requests require a named company and public HTTPS website", () => {
  assert.equal(validateResearchRequest("Acme Construction", "https://acme.example").ok, true);
  assert.equal(validateResearchRequest("", "https://acme.example").ok, false);
  assert.equal(validateResearchRequest("Acme", "http://acme.example").ok, false);
  assert.equal(validateResearchRequest("Acme", "https://localhost").ok, false);
  assert.equal(validateResearchRequest("Acme", "https://127.0.0.1").ok, false);
  assert.equal(validateResearchRequest("Acme", "https://user:pass@acme.example").ok, false);
  assert.equal(validateResearchRequest("Acme", "https://acme.example:8443").ok, false);
});

test("research URL removes search and fragment", () => {
  const result = validateResearchRequest("Acme", "https://www.acme.example/about?utm_source=x#team");
  assert.equal(result.ok, true);
  assert.equal(result.websiteUrl, "https://www.acme.example/about");
});

test("HTML extraction omits scripts and returns only same-domain role inboxes", () => {
  const html = \`<html><head><title>Acme Construction</title><script>secret@example.com</script></head>
  <body><h1>Commercial construction</h1><p>We build commercial projects.</p>
  <a href="/contact">Contact us</a><a href="https://other.example/contact">Other site</a>
  <p>Contact info@acme.example or Jane at jane@acme.example.</p>
  <p>sales@acme.example and info@other.example</p><footer>footer@example.com</footer></body></html>\`;
  const result = extractResearchPage(html, "https://www.acme.example/", "acme.example");
  assert.equal(result.title, "Acme Construction");
  assert.match(result.text, /Commercial construction/);
  assert.doesNotMatch(result.text, /secret@example.com/);
  assert.deepEqual(result.emails.map(item => item.email), ["info@acme.example", "sales@acme.example"]);
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

test("research prompt treats website text as data and requests sourced fit hypotheses", () => {
  const messages = buildSalesResearchMessages("Acme", "https://acme.example/", [
    { sourceUrl: "https://acme.example/", title: "Acme", text: "Commercial construction." }
  ]);
  assert.match(messages[0].content, /untrusted data/);
  assert.match(messages[1].content, /source_url/);
  assert.match(messages[1].content, /hypothesis/);
});

test("research output strips invalid source URLs and bounds fields", () => {
  const parsed = parseSalesResearchResult(JSON.stringify({
    business_summary: "A commercial builder", services: ["Construction", "  "],
    customer_types: ["Developers"],
    fit_signals: [
      { evidence: "The company builds projects", source_url: "https://acme.example/services" },
      { evidence: "Unsupported source", source_url: "javascript:alert(1)" }
    ],
    missing_information: ["Budget"], confidence: "high"
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.profile.fit_signals.length, 1);
  assert.equal(parsed.profile.confidence, "high");
  assert.equal(parseSalesResearchResult("not json").ok, false);
});
