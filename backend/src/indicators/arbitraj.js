// Global-Yerel Arbitraj Spread Analizi
// Binance Global fiyat × USDT/TRY − Binance TR fiyatı
// Negatif spread = yerel panik satışı = güçlü alım fırsatı

const axios = require('axios');

async function calcArbitraj(symbol, trFiyat, usdTryKur) {
  try {
    // Binance Global futures fiyatı
    const globalSembol = symbol.replace('TRY', 'USDT');
    const res = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price', {
      params:  { symbol: globalSembol.toUpperCase() },
      timeout: 4000
    });

    const globalFiyatUSDT = parseFloat(res.data.price);
    const globalFiyatTRY  = globalFiyatUSDT * usdTryKur;
    const spread          = trFiyat - globalFiyatTRY;
    const spreadPct       = parseFloat((spread / globalFiyatTRY * 100).toFixed(4));

    let signal  = 'NORMAL';
    let desc    = null;
    let score   = 0;

    if (spreadPct < -1.5) {
      signal = 'GUCLU_FIRSAT';
      desc   = `Binance TR ${Math.abs(spreadPct).toFixed(2)}% ucuz — yerel panik satışı`;
      score  = 4;
    } else if (spreadPct < -0.8) {
      signal = 'FIRSAT';
      desc   = `Binance TR ${Math.abs(spreadPct).toFixed(2)}% ucuz — tepki alımı bekle`;
      score  = 2;
    } else if (spreadPct > 1.5) {
      signal = 'PAHALI';
      desc   = `Binance TR ${spreadPct.toFixed(2)}% pahalı — arbitraj baskısı gelecek`;
      score  = -2;
    } else if (spreadPct > 0.8) {
      signal = 'HAFIF_PAHALI';
      desc   = `Binance TR hafif pahalı`;
      score  = -1;
    }

    return {
      globalFiyatUSDT: parseFloat(globalFiyatUSDT.toFixed(6)),
      globalFiyatTRY:  parseFloat(globalFiyatTRY.toFixed(2)),
      trFiyat:         parseFloat(trFiyat.toFixed(2)),
      spread:          parseFloat(spread.toFixed(2)),
      spreadPct,
      signal,
      desc,
      score,
      isOpportunity:   spreadPct < -0.8,
      isOverpriced:    spreadPct > 0.8
    };
  } catch (err) {
    return {
      globalFiyatUSDT: 0, globalFiyatTRY: 0, trFiyat,
      spread: 0, spreadPct: 0, signal: 'VERI_YOK',
      desc: null, score: 0, isOpportunity: false, isOverpriced: false
    };
  }
}

module.exports = { calcArbitraj };
