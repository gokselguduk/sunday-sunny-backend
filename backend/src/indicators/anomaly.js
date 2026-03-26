// Z-Score Anomali Tespiti
// Fiyat normal dağılımın dışına çıktığında manipülasyon/aşırı volatilite uyarısı

function detectAnomaly(candles) {
  if (!candles || candles.length < 20) return { isAnomaly: false, zScore: 0, signal: 'NORMAL' };

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const slice = closes.slice(-50);

  // Fiyat Z-Score
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const std  = Math.sqrt(slice.map(c => Math.pow(c - mean, 2)).reduce((a, b) => a + b, 0) / slice.length);
  const zScore = std > 0 ? (closes[closes.length - 1] - mean) / std : 0;

  // Hacim Z-Score
  const vSlice = volumes.slice(-50);
  const vMean  = vSlice.reduce((a, b) => a + b, 0) / vSlice.length;
  const vStd   = Math.sqrt(vSlice.map(v => Math.pow(v - vMean, 2)).reduce((a, b) => a + b, 0) / vSlice.length);
  const vZScore = vStd > 0 ? (volumes[volumes.length - 1] - vMean) / vStd : 0;

  // Fiyat değişim hızı anomalisi
  const last5  = closes.slice(-5);
  const pctChg = last5.length > 1 ? Math.abs((last5[last5.length-1] - last5[0]) / last5[0] * 100) : 0;

  const absZ   = Math.abs(zScore);
  let signal   = 'NORMAL';
  let isAnomaly = false;
  let reason   = null;

  if (absZ > 3.5) {
    isAnomaly = true; signal = 'MANIPULASYON'; reason = 'Fiyat istatistiksel sınırların çok ötesinde';
  } else if (absZ > 2.5 && vZScore > 2) {
    isAnomaly = true; signal = 'ASIRI_VOLATILITE'; reason = 'Yüksek volatilite + anormal hacim';
  } else if (absZ > 2.5) {
    isAnomaly = true; signal = 'DIKKAT'; reason = 'Fiyat normal dağılımın dışında';
  } else if (pctChg > 8) {
    isAnomaly = true; signal = 'ANI_HAREKET'; reason = `Son 5 mumda %${pctChg.toFixed(1)} hareket`;
  }

  return {
    isAnomaly, signal, reason,
    zScore:    parseFloat(zScore.toFixed(3)),
    vZScore:   parseFloat(vZScore.toFixed(3)),
    pctChg:    parseFloat(pctChg.toFixed(2)),
    mean:      parseFloat(mean.toFixed(4)),
    std:       parseFloat(std.toFixed(4))
  };
}

module.exports = { detectAnomaly };