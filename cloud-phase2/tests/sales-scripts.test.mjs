import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSalesScriptMessages,
  parseSalesScriptResult,
  renderSalesScript
} from "../src/sales-scripts.mjs";

test("sales script prompt forbids invented commercial claims", () => {
  const messages = buildSalesScriptMessages({
    product_name: "Contractor Profit Control Center",
    pricing: "Not stated",
    claims_to_verify: ["22% target margin"]
  });
  assert.match(messages[0].content, /Never invent pricing/);
  assert.match(messages[1].content, /Do not state a price/);
  assert.match(messages[1].content, /22% target margin/);
});

test("sales script parser requires core sections and bounds lists", () => {
  const input = {
    opening: "Thanks for your time.",
    elevator_pitch: "A workbook to help review project costs.",
    discovery_questions: ["How do you monitor project costs?"],
    value_points: ["Budget and actual cost tracking."],
    objection_responses: [{objection:"We use spreadsheets.",response:"This may complement your workflow."}],
    next_step: "Would you like to review a sample?",
    claims_to_avoid: ["Do not promise exact forecasting accuracy."]
  };
  const parsed = parseSalesScriptResult(JSON.stringify(input));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.script.objection_responses.length, 1);
  assert.equal(parseSalesScriptResult('{"opening":"hi"}').ok, false);
});

test("sales script output includes the claims-to-avoid section", () => {
  const parsed = parseSalesScriptResult(JSON.stringify({
    opening:"Hello.", elevator_pitch:"A spreadsheet product.",
    discovery_questions:["How do you track costs?"], value_points:["Forecasting worksheet."],
    objection_responses:[], next_step:"Review a sample.", claims_to_avoid:["Do not claim guaranteed profit."]
  }));
  assert.equal(parsed.ok, true);
  const output = renderSalesScript("Product", parsed.script);
  assert.match(output, /CLAIMS TO AVOID UNTIL VERIFIED/);
  assert.match(output, /guaranteed profit/);
});
