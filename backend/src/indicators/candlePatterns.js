// Mum Formasyonu Motoru
// Engulfing, Doji, Hammer, Shooting Star, Morning/Evening Star

function detectCandlePatterns(candles) {
  if (!candles || candles.length < 3) return { patterns: [], score: 0 };

  const patterns = [];
  let score = 0;

  const c  = candles[candles.length-1];  // Son mum
  const p1 = candles[candles.length-2];  // Önceki mum
  const p2 = candles[candles.length-3];  // 2 önceki mum

  const body     = Math.abs(c.close - c.open);
  const p1Body   = Math.abs(p1.close - p1.open);
  const range    = c.high - c.low;
  const p1Range  = p1.high - p1.low;
  const isBull   = c.close > c.open;
  const p1IsBull = p1.close > p1.open;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  // ── BULLISH FORMASYONLAR ──────────────────

  // Hammer (Çekiç): Küçük gövde, uzun alt fitil, üst trend dibinde
  if (body > 0 && lowerWick >= body * 2 && upperWick <= body * 0.5) {
    patterns.push({ type: 'BUY', name: 'Hammer', desc: 'Çekiç — dip sinyali' });
    score += 3;
  }

  // Bullish Engulfing: Önceki ayı mumunu tamamen yutuyor
  if (isBull && !p1IsBull && c.open < p1.close && c.close > p1.open && body > p1Body) {
    patterns.push({ type: 'BUY', name: 'Bullish Engulfing', desc: 'Boğa yutması — güçlü dönüş' });
    score += 4;
  }

  // Morning Star: Ayı + küçük doji + boğa
  if (!p1IsBull && p1Body < p1Range * 0.3 && isBull && p2 &&
      p2.close > p2.open === false && body > p1Body) {
    patterns.push({ type: 'BUY', name: 'Morning Star', desc: 'Sabah yıldızı — dip dönüşü' });
    score += 4;
  }

  // Bullish Doji: Çok küçük gövde, eşit fitiller
  if (body <= range * 0.1 && lowerWick > range * 0.3 && upperWick > range * 0.3) {
    patterns.push({ type: 'BUY', name: 'Doji', desc: 'Doji — kararsızlık, dönüş olabilir' });
    score += 1;
  }

  // Piercing Line: Ayı mumunun yarısından fazlasını kaplayan boğa mumu
  if (isBull && !p1IsBull && c.open < p1.low &&
      c.close > (p1.open + p1.close) / 2 && c.close < p1.open) {
    patterns.push({ type: 'BUY', name: 'Piercing Line', desc: 'Delici çizgi — dönüş sinyali' });
    score += 3;
  }

  // Three White Soldiers: 3 ardışık boğa mumu
  if (candles.length >= 3 && isBull && p1IsBull && p2 && p2.close > p2.open &&
      c.close > p1.close && p1.close > p2.close) {
    patterns.push({ type: 'BUY', name: 'Three White Soldiers', desc: '3 asker — güçlü yükseliş' });
    score += 3;
  }

  // ── BEARISH FORMASYONLAR ──────────────────

  // Shooting Star: Küçük gövde, uzun üst fitil
  if (body > 0 && upperWick >= body * 2 && lowerWick <= body * 0.5) {
    patterns.push({ type: 'SELL', name: 'Shooting Star', desc: 'Kayan yıldız — tepe sinyali' });
    score -= 3;
  }

  // Bearish Engulfing: Önceki boğa mumunu tamamen yutuyor
  if (!isBull && p1IsBull && c.open > p1.close && c.close < p1.open && body > p1Body) {
    patterns.push({ type: 'SELL', name: 'Bearish Engulfing', desc: 'Ayı yutması — güçlü düşüş' });
    score -= 4;
  }

  // Evening Star: Boğa + küçük doji + ayı
  if (p1IsBull && p1Body < p1Range * 0.3 && !isBull && p2 &&
      p2.close > p2.open && body > p1Body) {
    patterns.push({ type: 'SELL', name: 'Evening Star', desc: 'Akşam yıldızı — tepe dönüşü' });
    score -= 4;
  }

  // Hanging Man: Hammer görünümlü ama tepe bölgesinde
  if (body > 0 && lowerWick >= body * 2 && upperWick <= body * 0.5 && !isBull) {
    patterns.push({ type: 'SELL', name: 'Hanging Man', desc: 'Asılan adam — düşüş uyarısı' });
    score -= 2;
  }

  // Three Black Crows: 3 ardışık ayı mumu
  if (!isBull && !p1IsBull && p2 && p2.close < p2.open &&
      c.close < p1.close && p1.close < p2.close) {
    patterns.push({ type: 'SELL', name: 'Three Black Crows', desc: '3 karga — güçlü düşüş' });
    score -= 3;
  }

  return {
    patterns,
    score:      Math.max(-6, Math.min(6, score)),
    hasBullish: patterns.some(p => p.type === 'BUY'),
    hasBearish: patterns.some(p => p.type === 'SELL')
  };
}

module.exports = { detectCandlePatterns };