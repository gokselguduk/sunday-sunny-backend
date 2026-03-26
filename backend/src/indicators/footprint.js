// Footprint / Mum İçi Delta Analizi
// Her mumun içinde net alış/satış dengesi
// Yeşil mum + negatif delta = gizli satış baskısı = DİKKAT
// Kırmızı mum + pozitif delta = gizli alış baskısı = FIRSAT

const axios = require('axios');

async function getFootprintDelta(symbol) {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/aggTrades', {
      params: { symbol: symbol.toUpperCase(), limit: 1000 },
      timeout: 6000
    });

    const trades = res.data;
    if (!trades || trades.length === 0) return defaultResult();

    // Son 5 dakikayı 1 dakikalık dilimlere böl
    const now     = Date.now();
    const buckets = {};

    trades.forEach(t => {
      const min = Math.floor(t.T / 60000);
      if (!buckets[min]) buckets[min] = { buy: 0, sell: 0, total: 0 };
      const qty = parseFloat(t.q);
      if (!t.m) { buckets[min].buy  += qty; }
      else       { buckets[min].sell += qty; }
      buckets[min].total += qty;
    });

    const mins     = Object.values(buckets);
    const totalBuy  = mins.reduce((s, b) => s + b.buy,  0);
    const totalSell = mins.reduce((s, b) => s + b.sell, 0);
    const netDelta  = totalBuy - totalSell;
    const deltaRatio = (totalBuy + totalSell) > 0 ? netDelta / (totalBuy + totalSell) : 0;

    // Son mum delta trendi
    const lastMins   = mins.slice(-3);
    const deltaTrend = lastMins.every((b, i) =>
      i === 0 || (b.buy - b.sell) > (lastMins[i-1].buy - lastMins[i-1].sell)
    ) ? 'ARTIYOR' : lastMins.every((b, i) =>
      i === 0 || (b.buy - b.sell) < (lastMins[i-1].buy - lastMins[i-1].sell)
    ) ? 'AZALIYOR' : 'YATAY';

    // Absorpsiyon tespiti
    const absorption = detectAbsorption(mins);

    return {
      netDelta:    parseFloat(netDelta.toFixed(4)),
      deltaRatio:  parseFloat(deltaRatio.toFixed(4)),
      totalBuy:    parseFloat(totalBuy.toFixed(4)),
      totalSell:   parseFloat(totalSell.toFixed(4)),
      deltaTrend,
      absorption,
      bullishDelta: deltaRatio > 0.15,
      bearishDelta: deltaRatio < -0.15,
      strongBull:   deltaRatio > 0.35,
      strongBear:   deltaRatio < -0.35
    };
  } catch (err) {
    return defaultResult();
  }
}

function detectAbsorption(mins) {
  if (mins.length < 3) return { detected: false, type: null };

  // Yüksek satış hacmi ama fiyat düşmüyor = alış absorpsiyonu
  const avgSell = mins.reduce((s, b) => s + b.sell, 0) / mins.length;
  const lastSell = mins[mins.length - 1].sell;
  const lastBuy  = mins[mins.length - 1].buy;

  if (lastSell > avgSell * 2.5 && lastBuy > lastSell * 0.8) {
    return { detected: true, type: 'ALIS_ABSORPSIYONU', desc: 'Büyük satış absorbe ediliyor — güçlü alıcı var' };
  }
  if (lastBuy > avgSell * 2.5 && lastSell > lastBuy * 0.8) {
    return { detected: true, type: 'SATIS_ABSORPSIYONU', desc: 'Büyük alış absorbe ediliyor — güçlü satıcı var' };
  }

  return { detected: false, type: null };
}

function defaultResult() {
  return {
    netDelta: 0, deltaRatio: 0, totalBuy: 0, totalSell: 0,
    deltaTrend: 'YATAY', absorption: { detected: false, type: null },
    bullishDelta: false, bearishDelta: false, strongBull: false, strongBear: false
  };
}

module.exports = { getFootprintDelta };