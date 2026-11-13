# Polymarket NVIDIA CEO Forecaster — a make.fun entry

A make.fun bounty entry for "Forecast Polymarket's next NVIDIA CEO prices
minute by minute, 4 hours ahead" (`polymarket-nvidia-ceo-forecast-01`).

`main.ts` (Node 22, standard library only) reads a case file
(`/input/<id>.in`: 24 Polymarket markets, 72 hours of 1-minute Yes prices
up to a checkpoint) and writes a forecast (`/output/<id>.out`): for each
market and each of the 240 minutes after the checkpoint, five quantiles
(0.05, 0.25, 0.5, 0.75, 0.95) of that minute's price.

Method: per-market adaptive volatility. The median stays at the checkpoint
price (no drift — these are martingale prices). Each market gets its own
spread from its recent realized volatility (60-minute and 360-minute
windows, scaled down, capped), with the outer quantiles widened and the
inner ones narrowed to match the heavy-tailed, jumpy price moves.

Practice loss (mean pinball loss, 6 practice cases): **0.273142**, vs the
house baseline's 0.363589 — beats it by 25% in every practice case.
