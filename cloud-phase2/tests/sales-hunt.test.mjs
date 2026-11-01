import test from "node:test";
import assert from "node:assert/strict";
import { searchUSConstructionCompanies } from "../src/sales-hunt.mjs";

test("searches the US construction directory for companies with websites", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    assert.equal(options.method, "GET");
    return {
      ok: true,
      json: async () => ({
        total: 2,
        rows: [
          {
            name: "Example Construction LLC",
            website: "https://example-construction.com",
            locality: "Dallas",
            region: "Texas",
            email: "owner@gmail.com",
            phone: "+1 555 0100"
          },
          {
            name: "Another Builder Inc",
            website: "another-builder.example",
            locality: "Austin",
            region: "Texas",
            email: "person@gmail.com"
          }
        ]
      })
    };
  };

  try {
    const result = await searchUSConstructionCompanies({ limit: 5 });
    const url = new URL(requestedUrl);
    assert.equal(url.pathname, "/api/public/country/united-states/rows");
    assert.equal(url.searchParams.get("industry"), "Construction");
    assert.equal(url.searchParams.get("has_website"), "1");
    assert.equal(url.searchParams.get("sort"), "coverage");
    assert.equal(url.searchParams.get("has_email"), null);
    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[0].name, "Example Construction LLC");
    assert.equal(result.candidates[1].websiteUrl, "https://another-builder.example/");
    assert.equal("email" in result.candidates[0], false);
    assert.equal("phone" in result.candidates[0], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deduplicates websites and excludes social and directory profile URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      total: 4,
      rows: [
        { name: "Example LLC", website: "https://example.com" },
        { name: "Example LLC duplicate", website: "https://www.example.com/about" },
        { name: "Social page", website: "https://www.linkedin.com/company/example" },
        { name: "Valid Builder", website: "https://valid-builder.example" }
      ]
    })
  });
  try {
    const result = await searchUSConstructionCompanies({ limit: 10 });
    assert.deepEqual(result.candidates.map(item => item.hostname), ["example.com", "valid-builder.example"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports provider failures without pretending there are no matching companies", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 525 });
  try {
    const result = await searchUSConstructionCompanies();
    assert.equal(result.ok, false);
    assert.match(result.error, /HTTP 525/);
    assert.deepEqual(result.candidates, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("limits result count and safely handles malformed rows", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      rows: [
        null,
        { name: "Missing website" },
        { name: "Bad scheme", website: "javascript:alert(1)" },
        { name: "Userinfo URL", website: "https://user:pass@unsafe.example" },
        { name: "Only builder", website: "https://builder-one.example" },
        { name: "Second builder", website: "https://builder-two.example" }
      ]
    })
  });
  try {
    const result = await searchUSConstructionCompanies({ limit: 1 });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].name, "Only builder");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("retries a temporary 503 and succeeds when the public directory recovers", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 503, headers: { get: () => "0" } };
    }
    return {
      ok: true,
      json: async () => ({
        total: 1,
        rows: [{ name: "Recovered Builder LLC", website: "https://recovered-builder.example" }]
      })
    };
  };
  try {
    const result = await searchUSConstructionCompanies({ limit: 3 });
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
    assert.equal(result.candidates[0].name, "Recovered Builder LLC");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stops after three failed 503 attempts and reports the outage", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 503, headers: { get: () => "0" } };
  };
  try {
    const result = await searchUSConstructionCompanies();
    assert.equal(calls, 3);
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 3);
    assert.match(result.error, /HTTP 503 after 3 attempts/);
    assert.deepEqual(result.candidates, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
