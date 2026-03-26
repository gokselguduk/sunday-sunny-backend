/**
 * Hedef bölgelere yaklaşma süresi — sezgisel model (1H ATR ≈ tipik mum aralığı).
 * Gerçek süre piyasaya bağlıdır; garanti değildir.
 */

const MAX_BARS = 720; // 30 gün (1H)

function clampBars(n) {
  return Math.min(Math.max(1, Math.ceil(n)), MAX_BARS);
}

function formatHoursRange(minH, maxH) {
  if (maxH <= 72) {
    return `${minH}–${maxH} saat`;
  }
  const minD = (minH / 24).toFixed(1);
  const maxD = (maxH / 24).toFixed(1);
  return `${minD}–${maxD} gün`;
}

/**
 * @param {object} p
 * @param {number} p.tp1Pct
 * @param {number} p.tp2Pct
 * @param {number} p.tp3Pct
 * @param {number} p.atrPercent — H1 kapanışa göre ATR %
 * @param {boolean} [p.allAligned]
 * @param {string} [p.regimeType]
 * @param {number} [p.priceChange24h]
 */
function estimateTargetHorizon(p) {
  const tp1 = Number(p.tp1Pct) || 0;
  const tp2 = Number(p.tp2Pct) || 0;
  const tp3 = Number(p.tp3Pct) || 0;
  const atrP = Math.max(Number(p.atrPercent) || 0.15, 0.06);

  // Her 1H mumda hedefe "yazılan" ortalama oran (tüm range yön değil)
  let slowEff = 0.11;
  let fastEff = 0.42;
  if (p.allAligned) {
    slowEff *= 1.12;
    fastEff *= 1.18;
  }
  const chg = Number(p.priceChange24h);
  if (Number.isFinite(chg)) {
    if (chg > 4) fastEff *= 1.08;
    if (chg < -3) {
      slowEff *= 0.92;
      fastEff *= 0.88;
    }
  }
  const reg = (p.regimeType || '').toLowerCase();
  if (reg.includes('trend') || reg.includes('yüksek')) {
    fastEff *= 1.06;
  }

  function band(pctMove) {
    if (!pctMove || pctMove <= 0) return null;
    const minBars = clampBars(pctMove / (atrP * fastEff));
    const maxBars = clampBars(pctMove / (atrP * slowEff));
    const lo = Math.min(minBars, maxBars);
    const hi = Math.max(minBars, maxBars);
    return {
      minHours: lo,
      maxHours: hi,
      minDays: +(lo / 24).toFixed(2),
      maxDays: +(hi / 24).toFixed(2),
      labelTr: formatHoursRange(lo, hi)
    };
  }

  const b1 = band(tp1);
  const b2 = band(tp2);
  const b3 = band(tp3);

  let holdTr = '';
  if (b1) {
    holdTr = `TP1 mesafesine göre pozisyonu çoğu senaryoda en az ${b1.minHours} saat, zorlu koşullarda ${b1.maxHours} saate kadar açık tutmayı düşünün; TP2/TP3 için süre genelde uzar.`;
  }

  return {
    tp1: b1,
    tp2: b2,
    tp3: b3,
    basisTf: '1h',
    basisTr: '1 saatlik ATR (tipik mum aralığı) ve TP yüzdeleri; yönlü hareket kısmi varsayılır.',
    holdHintTr: holdTr,
    disclaimerTr: 'Tahmin aralığıdır, kesit tarih/saat değildir. Haber ve likidite süreyi kısaltır veya uzatır.'
  };
}

module.exports = { estimateTargetHorizon };
