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

test("tries the Ohio fallback after three failed nationwide directory attempts", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 503, headers: { get: () => "0" } };
  };
  try {
    const result = await searchUSConstructionCompanies();
    assert.equal(calls, 5); // three nationwide attempts plus two ProFix transports
    assert.equal(result.ok, false);
    assert.match(result.error, /HTTP 503 after 3 attempts/);
    assert.match(result.error, /Ohio fallback: ProFix Hugging Face snapshot returned HTTP 503; ProFix live feed returned HTTP 503/);
    assert.deepEqual(result.candidates, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("falls back to the Ohio ProFix catalogue and keeps only organization-level fields", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).includes("companies.directory")) {
      return { ok: false, status: 503, headers: { get: () => "0" } };
    }
    assert.equal(String(url), "https://huggingface.co/datasets/Pisces89/ohio-home-services-pros/resolve/main/profix-ohio-pros-latest.json");
    return {
      ok: true,
      json: async () => ({
        dataset: "profix-ohio-pros",
        version: "2026-05",
        coverage_state: "OH",
        record_count: 3,
        record: [
          {
            name: "Example Concrete LLC",
            state: "OH",
            city: "Columbus",
            county: "Franklin",
            trades: ["concrete", "roofing"],
            website_url: "https://example-concrete.example",
            slug: "example-concrete-columbus",
            verification_tier: "verified-profile",
            email: "owner@gmail.com",
            phone: "+1 555 0100"
          },
          {
            name: "Out of state",
            state: "PA",
            city: "Pittsburgh",
            trades: ["concrete"],
            website_url: "https://out-of-state.example",
            slug: "out-of-state"
          },
          {
            name: "Irrelevant repair shop",
            state: "OH",
            city: "Cleveland",
            trades: ["tech-repair"],
            website_url: "https://repair-shop.example",
            slug: "repair-shop"
          }
        ]
      })
    };
  };
  try {
    const result = await searchUSConstructionCompanies({ limit: 5 });
    assert.equal(calls, 4);
    assert.equal(result.ok, true);
    assert.equal(result.sourceLabel, "ProFix Directory (Ohio) — monthly Hugging Face snapshot");
    assert.equal(result.scopeLabel, "Ohio only");
    assert.equal(result.snapshotVersion, "2026-05");
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].name, "Example Concrete LLC");
    assert.equal(result.candidates[0].location, "Columbus, Franklin, Ohio, United States");
    assert.deepEqual(result.candidates[0].trades, ["concrete", "roofing"]);
    assert.equal(result.candidates[0].profileUrl, "https://profixdirectory.com/pro/example-concrete-columbus");
    assert.equal("email" in result.candidates[0], false);
    assert.equal("phone" in result.candidates[0], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
