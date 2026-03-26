// VWAP + Hacim Profili
// Kurumsal yatırımcıların referans aldığı seviye
// POC = en fazla işlemin olduğu fiyat seviyesi

function calculateVWAP(candles) {
  if (!candles || candles.length < 2) return { vwap: null, upperBand: null, lowerBand: null };

  let cumTPV  = 0; // Toplam (Tipik Fiyat × Hacim)
  let cumVol  = 0; // Toplam Hacim
  let cumTPV2 = 0; // Varyans için

  const vwapValues = [];

  candles.forEach(c => {
    const tp  = (c.high + c.low + c.close) / 3; // Tipik fiyat
    const vol = c.volume || 1;
    cumTPV  += tp * vol;
    cumVol  += vol;
    cumTPV2 += tp * tp * vol;
    const vwap = cumVol > 0 ? cumTPV / cumVol : tp;
    const variance = cumVol > 0 ? (cumTPV2 / cumVol) - (vwap * vwap) : 0;
    const std = Math.sqrt(Math.max(0, variance));
    vwapValues.push({ vwap, std, tp });
  });

  const last     = vwapValues[vwapValues.length-1];
  const lastClose = candles[candles.length-1].close;

  return {
    vwap:       parseFloat(last.vwap.toFixed(4)),
    upperBand1: parseFloat((last.vwap + last.std).toFixed(4)),
    upperBand2: parseFloat((last.vwap + last.std * 2).toFixed(4)),
    lowerBand1: parseFloat((last.vwap - last.std).toFixed(4)),
    lowerBand2: parseFloat((last.vwap - last.std * 2).toFixed(4)),
    priceVsVWAP: lastClose > last.vwap ? 'ABOVE' : 'BELOW',
    distancePct: parseFloat(((lastClose - last.vwap) / last.vwap * 100).toFixed(2)),
    bullish:    lastClose > last.vwap,
    vwapValues: vwapValues.slice(-20).map(v => parseFloat(v.vwap.toFixed(4)))
  };
}

// Hacim Profili — POC tespiti
function calculateVolumeProfile(candles) {
  if (!candles || candles.length < 10) return { poc: null, valueAreaHigh: null, valueAreaLow: null };

  const prices  = candles.map(c => c.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range    = maxPrice - minPrice;

  if (range === 0) return { poc: null, valueAreaHigh: null, valueAreaLow: null };

  // 20 fiyat seviyesine böl
  const levels   = 20;
  const step     = range / levels;
  const profile  = new Array(levels).fill(0);

  candles.forEach(c => {
    const vol = c.volume || 1;
    const idx = Math.min(Math.floor((c.close - minPrice) / step), levels - 1);
    profile[idx] += vol;
  });

  // POC — en yüksek hacimli seviye
  const maxVol  = Math.max(...profile);
  const pocIdx  = profile.indexOf(maxVol);
  const poc     = parseFloat((minPrice + pocIdx * step + step/2).toFixed(4));

  // Value Area — toplam hacmin %70'ini kapsayan bölge
  const totalVol = profile.reduce((a,b) => a+b, 0);
  const target   = totalVol * 0.7;

  let vaVol  = maxVol;
  let vaLow  = pocIdx;
  let vaHigh = pocIdx;

  while (vaVol < target && (vaLow > 0 || vaHigh < levels-1)) {
    const downVol = vaLow  > 0        ? profile[vaLow-1]  : 0;
    const upVol   = vaHigh < levels-1 ? profile[vaHigh+1] : 0;
    if (downVol >= upVol && vaLow > 0)        { vaLow--;  vaVol += downVol; }
    else if (vaHigh < levels-1)               { vaHigh++; vaVol += upVol;  }
    else break;
  }

  const lastClose = candles[candles.length-1].close;

  return {
    poc:          poc,
    valueAreaHigh: parseFloat((minPrice + vaHigh * step + step).toFixed(4)),
    valueAreaLow:  parseFloat((minPrice + vaLow  * step).toFixed(4)),
    priceVsPOC:   lastClose > poc ? 'ABOVE' : 'BELOW',
    pocDistance:  parseFloat(((lastClose - poc) / poc * 100).toFixed(2))
  };
}

module.exports = { calculateVWAP, calculateVolumeProfile };