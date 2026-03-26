function calcVolatilityRegime(tf) {
  const atrPct = tf?.h1?.atr?.tp1Pct || 0;
  if (atrPct >= 3.5) return { level: 'HIGH', atrPct };
  if (atrPct >= 1.8) return { level: 'MEDIUM', atrPct };
  return { level: 'LOW', atrPct };
}

function calcLiquidityQuality(orderBook) {
  const ratio = orderBook?.bidAskRatio || 1;
  const hasWallRisk = Boolean(orderBook?.sellWall);
  const delta = orderBook?.deltaRatio || 0;

  let score = 50;
  if (ratio > 1.2) score += 15;
  if (ratio < 0.9) score -= 15;
  if (delta > 0.08) score += 10;
  if (delta < -0.08) score -= 10;
  if (hasWallRisk) score -= 10;

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return { score: bounded, ratio, delta, hasWallRisk };
}

function calcTrendHealth(tf) {
  const trendStrength = tf?.h1?.trend?.strength || 0;
  const vwapBullish = Boolean(tf?.h1?.vwap?.bullish);
  const divergenceConflict = Boolean(tf?.h1?.divergence?.bearish || tf?.h1?.divergence?.hidden_bearish);

  let score = 40 + trendStrength * 10;
  if (vwapBullish) score += 15;
  if (divergenceConflict) score -= 20;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    trendStrength,
    vwapBullish,
    divergenceConflict
  };
}

function buildDiagnostics({ tf, orderBook }) {
  const volatility = calcVolatilityRegime(tf);
  const liquidity = calcLiquidityQuality(orderBook);
  const trendHealth = calcTrendHealth(tf);

  return {
    volatility,
    liquidity,
    trendHealth
  };
}

module.exports = { buildDiagnostics };
