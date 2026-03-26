// Fair Value Gap (FVG) / Likidite Boşluğu Analizi
// Fiyatın verimsiz geçtiği alanlar — fiyat geri dönüp doldurur
// Güçlü TP/SL ve hedef seviyeleri için kullan

function detectFVG(candles) {
  if (!candles || candles.length < 5) return { bullishFVGs: [], bearishFVGs: [], nearestBullish: null, nearestBearish: null };

  const bullishFVGs = [];
  const bearishFVGs = [];
  const last = candles[candles.length - 1].close;

  for (let i = 2; i < candles.length; i++) {
    const prev2 = candles[i - 2];
    const prev1 = candles[i - 1];
    const curr  = candles[i];

    // Bullish FVG: önceki mumun high'ı ile sonraki mumun low'u arasında boşluk
    // curr.low > prev2.high → yukarı boşluk
    if (curr.low > prev2.high) {
      bullishFVGs.push({
        top:      curr.low,
        bottom:   prev2.high,
        mid:      (curr.low + prev2.high) / 2,
        size:     parseFloat(((curr.low - prev2.high) / prev2.high * 100).toFixed(3)),
        time:     curr.time,
        filled:   false
      });
    }

    // Bearish FVG: önceki mumun low'u ile sonraki mumun high'ı arasında boşluk
    // curr.high < prev2.low → aşağı boşluk
    if (curr.high < prev2.low) {
      bearishFVGs.push({
        top:      prev2.low,
        bottom:   curr.high,
        mid:      (prev2.low + curr.high) / 2,
        size:     parseFloat(((prev2.low - curr.high) / curr.high * 100).toFixed(3)),
        time:     curr.time,
        filled:   false
      });
    }
  }

  // Dolmamış FVG'leri filtrele (fiyat içinden geçmemiş)
  const activeBullish = bullishFVGs
    .filter(g => last > g.bottom)
    .sort((a, b) => b.bottom - a.bottom)
    .slice(0, 5);

  const activeBearish = bearishFVGs
    .filter(g => last < g.top)
    .sort((a, b) => a.top - b.top)
    .slice(0, 5);

  // En yakın FVG'ler
  const nearestBullish = activeBullish.length > 0 ? activeBullish[0] : null;
  const nearestBearish = activeBearish.length > 0 ? activeBearish[0] : null;

  // Fiyat FVG içinde mi?
  const inBullishFVG = activeBullish.some(g => last >= g.bottom && last <= g.top);
  const inBearishFVG = activeBearish.some(g => last >= g.bottom && last <= g.top);

  // FVG'ye mesafe
  const bullishDist = nearestBullish ? parseFloat(((last - nearestBullish.mid) / last * 100).toFixed(2)) : null;
  const bearishDist = nearestBearish ? parseFloat(((nearestBearish.mid - last) / last * 100).toFixed(2)) : null;

  return {
    bullishFVGs:    activeBullish,
    bearishFVGs:    activeBearish,
    nearestBullish,
    nearestBearish,
    inBullishFVG,
    inBearishFVG,
    bullishDist,
    bearishDist,
    hasBullishFVG:  activeBullish.length > 0,
    hasBearishFVG:  activeBearish.length > 0
  };
}

module.exports = { detectFVG };