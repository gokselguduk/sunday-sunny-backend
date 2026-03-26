function resolveRegime(tf, priceChange24h) {
  let regime = 'TREND';
  if (tf.h1.volume?.isLow) regime = 'RANGE';
  if (Math.abs(priceChange24h) > 10) regime = 'BREAKOUT';
  const regimeScore = regime === 'BREAKOUT' ? 3 : regime === 'TREND' ? 1 : -1;
  return { regime, regimeScore };
}

function calculateExtraScore({ sentiment, dirs, tf, footprint, arbitraj, orderBook, regimeScore }) {
  let extraScore = 0;
  extraScore += regimeScore;
  extraScore += Math.max(-4, Math.min(4, orderBook.orderFlowScore));

  if (sentiment?.isExtremeFear && dirs.dir1h > 0) extraScore += 2;
  if (sentiment?.isFear && dirs.dir1h > 0) extraScore += 1;
  if (sentiment?.isExtremeGreed) extraScore -= 1;

  if (tf.h1.divergence?.bullish) extraScore += 3;
  if (tf.h1.divergence?.hidden_bullish) extraScore += 2;
  if (tf.h1.divergence?.bearish) extraScore -= 3;

  extraScore += tf.h1.candlePatterns?.score || 0;
  if (tf.h1.vwap?.bullish && tf.h1.vwap?.distancePct < 2) extraScore += 1;
  if (tf.h1.volumeProfile?.poc && Math.abs(tf.h1.volumeProfile.pocDistance) < 1) extraScore += 2;
  if (tf.h1.fvg?.inBullishFVG) extraScore += 3;

  if (footprint?.strongBull) extraScore += 2;
  if (footprint?.bullishDelta) extraScore += 1;
  if (footprint?.strongBear) extraScore -= 2;
  if (arbitraj?.score) extraScore += arbitraj.score;

  return extraScore;
}

function applyAnomalyPenalty(tf, extraScore) {
  if (tf.h1.anomaly?.signal === 'MANIPULASYON') {
    return { reject: true, extraScore };
  }

  if (tf.h1.anomaly?.isAnomaly) {
    return { reject: false, extraScore: Math.round(extraScore * 0.5) };
  }

  return { reject: false, extraScore };
}

module.exports = { resolveRegime, calculateExtraScore, applyAnomalyPenalty };
