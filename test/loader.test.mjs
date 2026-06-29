import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeDealEconomics, formatMoney } from "../src/economics.mjs";
import { loadDeal, toTranscript } from "../src/deal-loader.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("computeDealEconomics grounds the discount and margin math", () => {
  const e = computeDealEconomics({
    arr: 1_200_000,
    grossMarginPct: 0.8,
    discountAskedPct: 0.18,
    discountFloorPct: 0.08,
    termYears: 1
  });
  assert.equal(e.discount_cost_arr, 216_000);
  assert.equal(e.margin_cost_arr, 172_800);
  assert.equal(e.exceeds_floor, true);
  assert.equal(e.over_floor_cost_arr, 120_000);
  assert.match(e.summary, /\$216k/);
});

test("computeDealEconomics accepts whole-number percentages", () => {
  const e = computeDealEconomics({ arr: 100_000, discountAskedPct: 12, discountFloorPct: 10 });
  assert.equal(e.discount_asked_pct, 0.12);
  assert.equal(e.discount_cost_arr, 12_000);
  assert.equal(e.exceeds_floor, true);
});

test("computeDealEconomics handles a missing/zero deal", () => {
  const e = computeDealEconomics({});
  assert.equal(e.discount_cost_arr, 0);
  assert.equal(e.exceeds_floor, false);
  assert.match(e.summary, /No discount/);
});

test("formatMoney renders k/M with currency symbols", () => {
  assert.equal(formatMoney(216_000, "USD"), "$216k");
  assert.equal(formatMoney(1_200_000, "USD"), "$1.2M");
  assert.equal(formatMoney(24_000, "EUR"), "€24k");
});

test("toTranscript parses speaker-prefixed lines and defaults to Buyer", () => {
  const t = toTranscript("Buyer: hello\nSeller: hi\nno prefix here");
  assert.equal(t.length, 3);
  assert.equal(t[0].speaker, "Buyer");
  assert.equal(t[1].speaker, "Seller");
  assert.equal(t[2].speaker, "Buyer");
  assert.equal(t[2].text, "no prefix here");
});

test("loadDeal reads a custom deal folder of plain files", async () => {
  const deal = await loadDeal(path.join(rootDir, "deals", "example-acme-renewal"));
  assert.equal(deal.context.account, "Acme Manufacturing");
  assert.equal(deal.context.documents.length, 3);
  assert.ok(deal.context.documents.some((d) => /Crm Brief/i.test(d.title)));
  assert.equal(deal.transcript.length, 3);
  assert.equal(deal.transcript[0].speaker, "Buyer");
  assert.equal(deal.context.economics.discount_cost_arr, 72_000);
  assert.equal(deal.imageDataUri, ""); // no redline image in the sample
});

test("loadDeal reads the bundled demo json shape", async () => {
  const deal = await loadDeal(path.join(rootDir, "data", "deal-room-demo.json"));
  assert.equal(deal.context.account, "Northstar Retail");
  assert.equal(deal.transcript.length, 3);
  assert.ok(deal.context.economics.discount_cost_arr > 0);
  assert.ok(deal.currentLine.length > 0);
});
