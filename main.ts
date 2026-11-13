// polymarket-nvidia-ceo-forecast-01 entry (Node 22, standard library only): per-market
// adaptive-volatility persistence forecast. Each market's Yes price stays where it was
// at the checkpoint (a martingale: no drift — drift toward the recent mean was tested on
// the practice and made the loss worse), with a spread that widens like a random walk's:
//
//   q_tau(h) = clamp(x + z_tau * f_tau * sigma_market * sqrt(h), 0, 1), rounded to 6 decimals
//
// where x is the market's price at the checkpoint, z_tau the standard normal's quantile
// at each level (-1.644854, -0.674490, 0, 0.674490, 1.644854), f_tau widens the outer
// quantiles and narrows the inner ones ([1.2, 0.8, 1.0, 0.8, 1.2] — these prices move in
// flat stretches with occasional jumps, so their distribution has heavier tails than a
// normal), and sigma_market is that market's own recent realized volatility:
//
//   sigma = min(0.01, max(0.0002, 0.3 * rv(60 min), 0.2 * rv(360 min)))
//
// rv(window) is the standard deviation of the 1-minute price moves over the last
// `window` minutes. Markets differ hugely in volatility (one jumped 0.35 -> 0.59 in a
// minute), so a fixed spread over- or under-shoots most of them; the two windows let a
// market that just started moving widen quickly (60-min window) while a quiet market
// stays narrow (360-min window). The floor keeps a spread even for a market that has
// not moved at all; the cap keeps one wild hour from blowing the spread out.
//
// Practice loss (6 cases p00-p05, scored against Polymarket's own recorded history):
// 0.273142, vs the house baseline's fixed 0.0025 spread at 0.363589. Rule beats the
// baseline in every practice case.
//
// It reads every <id>.in in the input directory (the grader runs one case at a time,
// with only that case's file there) and writes <id>.out for each: {"forecasts":
// [{"id","q"}]}, every market of the case exactly once, `q` exactly horizon_minutes
// rows, each row the five quantiles in order, each in [0,1] and non-decreasing, at most
// 1 MiB. Deterministic: no network, no randomness, no clock, so two runs write the
// same bytes.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in
// for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level, to 6 decimals. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
/** Outer quantiles widened, inner narrowed: jumpy prices have heavier tails. */
const TAIL = [1.2, 0.8, 1.0, 0.8, 1.2];
/** Spread floor and cap, in price units per square-root minute. */
const SIGMA_FLOOR = 0.0002;
const SIGMA_CAP = 0.01;
/** How much of each window's realized volatility the spread takes. */
const SHORT_K = 0.3; // 60-minute window: reacts fast when a market starts moving
const LONG_K = 0.2; // 360-minute window: the market's usual restlessness

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/**
 * The standard deviation of the 1-minute price moves over the last `window`
 * minutes (at most the history's length). Prices move in steps, so most moves
 * are 0 and a few are jumps; the spread of those moves is the market's
 * realized volatility in price units per minute. Single-pass (Welford) so a
 * long history costs one walk and the variance stays numerically stable.
 */
function realizedVol(prices: number[], window: number): number {
  const start = Math.max(0, prices.length - window - 1);
  const n = prices.length - 1 - start;
  if (n < 2) return 0;
  let mean = 0;
  let m2 = 0;
  for (let i = start; i < prices.length - 1; i++) {
    const d = prices[i + 1] - prices[i];
    const delta = d - mean;
    mean += delta / (i - start + 1);
    m2 += delta * (d - mean);
  }
  return Math.sqrt(m2 / n);
}

/** One market's spread: the larger of its short- and long-window volatilities, floored and capped. */
function marketSigma(prices: number[]): number {
  const sigma = Math.max(SHORT_K * realizedVol(prices, 60), LONG_K * realizedVol(prices, 360));
  return Math.min(SIGMA_CAP, Math.max(SIGMA_FLOOR, sigma));
}

/** The adaptive forecast of one market: horizon rows of the five quantiles around its last price. */
function forecast(m: CaseMarket, horizon: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  const sigma = marketSigma(m.prices);
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const spread = sigma * Math.sqrt(h);
    rows.push(Z.map((z, j) => price6(x + z * (TAIL[j] as number) * spread)));
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
