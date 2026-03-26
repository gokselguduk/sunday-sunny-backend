function resolveRegime(tf, priceChange24h) {
  let regime = 'TREND';
  if (tf.h1.volume?.isLow) regime = 'RANGE';

  const move = Math.abs(priceChange24h);
  if (move > 10) {
    regime = tf.h1.volume?.isLow ? 'SPIKE_LOW_VOL' : 'BREAKOUT';
  }

  let regimeScore = 1;
  if (regime === 'BREAKOUT') regimeScore = 3;
  else if (regime === 'TREND') regimeScore = 1;
  else regimeScore = -1;

  return { regime, regimeScore };
}

/** Sadece 1h mum skorunda OLMAYAN katkılar (divergence/FVG/mum/VWAP/POC zaten analyzeCandles içinde). */
function calculateExtraScore({ sentiment, dirs, footprint, arbitraj, orderBook, regimeScore }) {
  let extraScore = 0;
  extraScore += regimeScore;
  extraScore += Math.max(-4, Math.min(4, orderBook.orderFlowScore));

  if (sentiment?.isExtremeFear && dirs.dir1h > 0) extraScore += 2;
  if (sentiment?.isFear && dirs.dir1h > 0) extraScore += 1;
  if (sentiment?.isExtremeGreed) extraScore -= 1;

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
