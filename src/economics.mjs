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
  // Incremental close probability the discount is expected to buy, as a fraction
  // (accepts 0.08 or 8). Drives the expected-value netting below.
  const closeProbLiftPts = clampFraction(econ.closeProbLiftPts, 0);

  // A list-price discount is a 1:1 gross-margin loss: cost-to-serve is unchanged,
  // so every dollar discounted comes straight out of gross margin.
  const discountCostArr = round(arr * discountAskedPct);
  const discountCostTerm = round(discountCostArr * termYears);
  const dealGrossMarginArr = round(arr * grossMarginPct);

  // Expected value of the close-probability lift the discount buys: the extra
  // probability of winning applied to the deal's gross margin.
  const expectedCloseGainArr = round(closeProbLiftPts * dealGrossMarginArr);

  // Net margin at risk = what you give away, netted against the expected gain
  // from the higher close probability. This is the headline "net margin leak".
  const netMarginRiskArr = Math.max(0, discountCostArr - expectedCloseGainArr);

  const exceedsFloor = discountAskedPct > discountFloorPct + 1e-9;
  const overFloorPct = Math.max(0, discountAskedPct - discountFloorPct);
  const overFloorCostArr = round(arr * overFloorPct);

  const fmt = (value) => formatMoney(value, currency);

  const parts = [];
  if (arr > 0 && discountAskedPct > 0) {
    parts.push(
      `A ${pct(discountAskedPct)} discount on ${fmt(arr)} ARR gives away ${fmt(discountCostArr)}/yr in gross margin` +
        (termYears > 1 ? ` (${fmt(discountCostTerm)} over ${termYears} yrs)` : "") +
        `.`
    );
    if (expectedCloseGainArr > 0) {
      parts.push(
        `Netted against the ${pct(closeProbLiftPts)} close-probability lift it buys (~${fmt(expectedCloseGainArr)} expected won margin), the net margin risk is ${fmt(netMarginRiskArr)}.`
      );
    }
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
    close_prob_lift_pts: closeProbLiftPts,
    discount_cost_arr: discountCostArr,
    discount_cost_term: discountCostTerm,
    deal_gross_margin_arr: dealGrossMarginArr,
    expected_close_gain_arr: expectedCloseGainArr,
    net_margin_risk_arr: netMarginRiskArr,
    // Backward-compatible alias: the full gross margin given away (= discount cost
    // for a 1:1 price cut), kept so older readers don't break.
    margin_cost_arr: discountCostArr,
    exceeds_floor: exceedsFloor,
    over_floor_cost_arr: overFloorCostArr,
    summary: parts.join(" "),
    formatted: {
      arr: fmt(arr),
      discount_cost_arr: fmt(discountCostArr),
      net_margin_risk_arr: fmt(netMarginRiskArr),
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
