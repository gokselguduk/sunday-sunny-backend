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

function applyAnomalyPenalty(tf, extraScore) {
  if (tf.h1.anomaly?.signal === 'MANIPULASYON') {
    return { reject: true, extraScore };
  }

  if (tf.h1.anomaly?.isAnomaly) {
    return { reject: false, extraScore: Math.round(extraScore * 0.5) };
  }

  return { reject: false, extraScore };
}

module.exports = { resolveRegime, applyAnomalyPenalty };
