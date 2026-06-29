// Deterministic deal-economics engine.
//
// LLMs are good at strategy and bad at arithmetic. Every dollar figure the
// agents cite is computed here from the deal's structured inputs, so the
// recommendation is grounded in real numbers instead of hallucinated ones.
// The synthesizer is told to reuse these figures verbatim.

export function computeDealEconomics(econ = {}) {
  const currency = typeof econ.currency === "string" ? econ.currency : "USD";
  const arr = num(econ.arr, 0);
  const grossMarginPct = clampFraction(econ.grossMarginPct, 0.8);
  const discountAskedPct = clampFraction(econ.discountAskedPct, 0);
  const discountFloorPct = clampFraction(econ.discountFloorPct, 0.08);
  const termYears = Math.max(1, num(econ.termYears, 1));

  const discountCostArr = round(arr * discountAskedPct);
  const discountCostTerm = round(discountCostArr * termYears);
  const marginCostArr = round(discountCostArr * grossMarginPct);
  const exceedsFloor = discountAskedPct > discountFloorPct + 1e-9;
  const overFloorPct = Math.max(0, discountAskedPct - discountFloorPct);
  const overFloorCostArr = round(arr * overFloorPct);

  const fmt = (value) => formatMoney(value, currency);

  const parts = [];
  if (arr > 0 && discountAskedPct > 0) {
    parts.push(
      `A ${pct(discountAskedPct)} discount on ${fmt(arr)} ARR costs ${fmt(discountCostArr)}/yr` +
        (termYears > 1 ? ` (${fmt(discountCostTerm)} over ${termYears} yrs)` : "") +
        `, about ${fmt(marginCostArr)} in gross margin.`
    );
  }
  if (exceedsFloor) {
    parts.push(
      `It exceeds the ${pct(discountFloorPct)} approval floor by ${pct(overFloorPct)} (${fmt(overFloorCostArr)}), so it needs sign-off.`
    );
  }
  if (!parts.length) parts.push("No discount has been quantified for this deal.");

  return {
    currency,
    arr,
    gross_margin_pct: grossMarginPct,
    discount_asked_pct: discountAskedPct,
    discount_floor_pct: discountFloorPct,
    term_years: termYears,
    discount_cost_arr: discountCostArr,
    discount_cost_term: discountCostTerm,
    margin_cost_arr: marginCostArr,
    exceeds_floor: exceedsFloor,
    over_floor_cost_arr: overFloorCostArr,
    summary: parts.join(" "),
    formatted: {
      arr: fmt(arr),
      discount_cost_arr: fmt(discountCostArr),
      margin_cost_arr: fmt(marginCostArr),
      over_floor_cost_arr: fmt(overFloorCostArr)
    }
  };
}

export function formatMoney(value, currency = "USD") {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(Math.round(value));
  const symbol = { USD: "$", EUR: "€", GBP: "£" }[currency] || "";
  let text;
  if (abs >= 1_000_000) text = `${trim(abs / 1_000_000)}M`;
  else if (abs >= 1_000) text = `${trim(abs / 1_000)}k`;
  else text = String(abs);
  const suffix = symbol ? "" : ` ${currency}`;
  return `${sign}${symbol}${text}${suffix}`;
}

function trim(n) {
  return Number(n.toFixed(1)).toString();
}

function pct(fraction) {
  return `${Number((fraction * 100).toFixed(1))}%`;
}

function clampFraction(value, fallback) {
  let n = num(value, fallback);
  if (n > 1) n = n / 100; // accept 18 as 18%
  return Math.min(1, Math.max(0, n));
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value) {
  return Math.round(value);
}
