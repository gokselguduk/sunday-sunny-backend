const axios = require('axios');

const BASE  = 'https://fapi.binance.com/fapi/v1';
const SPOT  = 'https://api.binance.com/api/v3';
const DELAY = 500;

function bekle(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Binance spot tüm BASETRY çiftlerinin kitap fiyatı (tek istek).
 * Binance.tr API bazı bölgelerde kapalı; TRY çiftleri global spot ile aynı köprüyü verir.
 */
async function getTryPairBookMap() {
  const res = await axios.get(`${SPOT}/ticker/bookTicker`, { timeout: 26000 });
  const arr = Array.isArray(res.data) ? res.data : [];
  const map = {};
  for (const row of arr) {
    const sym = row.symbol;
    if (!sym || !sym.endsWith('TRY') || sym === 'USDTTRY') continue;
    const base = sym.slice(0, -3);
    if (!/^[A-Z0-9]{2,20}$/.test(base)) continue;
    const bid = parseFloat(row.bidPrice);
    const ask = parseFloat(row.askPrice);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) continue;
    map[base] = { bid, ask, mid: (bid + ask) / 2, symbolTry: sym };
  }
  return map;
}

/** Tek coin için spot BASETRY kitabı (tek coin yenilemede). */
async function getTryBookForBase(base) {
  const b = String(base || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!b) return null;
  const sym = `${b}TRY`;
  try {
    const res = await axios.get(`${SPOT}/ticker/bookTicker`, {
      params: { symbol: sym },
      timeout: 7000
    });
    const row = res.data;
    const bid = parseFloat(row.bidPrice);
    const ask = parseFloat(row.askPrice);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
    return { bid, ask, mid: (bid + ask) / 2, symbolTry: sym };
  } catch {
    return null;
  }
}

async function getUSDTRY() {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price', {
      params: { symbol: 'USDTTRY' },
      timeout: 5000
    });
    return parseFloat(res.data.price) || 38;
  } catch (e) {
    // Spot'tan dene
    try {
      const res2 = await axios.get('https://api.binance.com/api/v3/ticker/price', {
        params: { symbol: 'USDTTRY' },
        timeout: 5000
      });
      return parseFloat(res2.data.price) || 38;
    } catch (e2) {
      return 38;
    }
  }
}

async function getTRYCoins() {
  try {
    const trListe = parseConfiguredSymbols(process.env.BINANCE_TR_COINS);

    // Binance Futures'ta aktif perpetual coinleri çek
    const infoRes = await axios.get(`${BASE}/exchangeInfo`, { timeout: 8000 });
    const futuresPairs = new Set(
      infoRes.data.symbols
        .filter(s => s.status === 'TRADING' && s.contractType === 'PERPETUAL')
        .map(s => s.baseAsset.toUpperCase())
    );

    // Her iki listede de olanları seç
    const coins = trListe
      .filter(symbol => futuresPairs.has(symbol))
      .map(symbol => ({
        id:     symbol.toLowerCase(),
        symbol: symbol,
        pair:   symbol + 'USDT'
      }));

    console.log(`Binance TR + Futures ortak: ${coins.length} coin (TR'de ${trListe.length}, Futures'ta ${futuresPairs.size})`);
    return coins;
  } catch (err) {
    console.error('Coin listesi alinamadi:', err.message);
    return ['BTC','ETH','BNB','SOL','XRP'].map(s => ({
      id: s.toLowerCase(), symbol: s, pair: s+'USDT'
    }));
  }
}

const DEFAULT_TR_BASES = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOGE', 'DOT', 'LINK', 'LTC', 'ATOM'];

function parseConfiguredSymbols(rawList) {
  if (!rawList || !String(rawList).trim()) return [...DEFAULT_TR_BASES];

  const parsed = [
    ...new Set(
      String(rawList)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .map((s) => s.replace(/^BINANCE_TR_COINS=/, ''))
        .filter((s) => /^[A-Z0-9]+$/.test(s))
    )
  ];
  if (!parsed.length) {
    console.warn('BINANCE_TR_COINS geçersiz veya boş; varsayılan evren kullanılıyor');
    return [...DEFAULT_TR_BASES];
  }
  return parsed;
}
async function getOHLCV(symbol, interval, limit) {
  if (!limit) limit = 500;
  // Binance USDT-M klines: limit max 1500
  limit = Math.min(1500, Math.max(1, Math.floor(Number(limit)) || 500));
  try {
    const res = await axios.get(`${BASE}/klines`, {
      params: { symbol: symbol.toUpperCase(), interval, limit },
      timeout: 8000
    });
    return res.data.map(k => ({
      time:   k[0],
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closed: true
    }));
  } catch (err) {
    throw new Error(`Candle alinamadi ${symbol} ${interval}: ${err.message}`);
  }
}

async function get24hTicker(symbol) {
  try {
    const res = await axios.get(`${BASE}/ticker/24hr`, {
      params: { symbol: symbol.toUpperCase() },
      timeout: 5000
    });
    return res.data;
  } catch (err) {
    return null;
  }
}

/**
 * Tüm USDT-M perpetual 24s ticker (tek istek). Isı haritası / piyasa özeti için.
 * @returns {Record<string, { lastPrice: number, priceChangePercent: number|null, quoteVolume: number|null, highPrice: number|null, lowPrice: number|null }>}
 */
async function getAllFutures24hTickers() {
  const res = await axios.get(`${BASE}/ticker/24hr`, { timeout: 22000 });
  const arr = Array.isArray(res.data) ? res.data : [];
  const out = {};
  for (const t of arr) {
    const sym = t.symbol;
    if (!sym || typeof sym !== 'string' || !sym.endsWith('USDT')) continue;
    const last = parseFloat(t.lastPrice);
    if (!Number.isFinite(last) || last <= 0) continue;
    const pct = parseFloat(t.priceChangePercent);
    const qv = parseFloat(t.quoteVolume);
    const high = parseFloat(t.highPrice);
    const low = parseFloat(t.lowPrice);
    out[sym] = {
      lastPrice: last,
      priceChangePercent: Number.isFinite(pct) ? pct : null,
      quoteVolume: Number.isFinite(qv) && qv >= 0 ? qv : null,
      highPrice: Number.isFinite(high) ? high : null,
      lowPrice: Number.isFinite(low) ? low : null
    };
  }
  return out;
}

/** Taramalar arası hafif canlı fiyat (USDT-M işlem fiyatı), rate limit için sıralı + kısa bekleme */
async function getMarkPricesBulk(symbols, delayMs = 55) {
  const uniq = [...new Set((symbols || []).map((s) => String(s).toUpperCase()))]
    .filter(Boolean)
    .slice(0, 30);
  const out = {};
  for (const sym of uniq) {
    try {
      const res = await axios.get(`${BASE}/ticker/price`, {
        params: { symbol: sym },
        timeout: 4000
      });
      const p = parseFloat(res.data?.price);
      if (Number.isFinite(p)) out[sym] = p;
    } catch (e) {
      // atla
    }
    await bekle(delayMs);
  }
  return out;
}

async function getOrderBook(symbol) {
  try {
    const res = await axios.get(`${BASE}/depth`, {
      params: { symbol: symbol.toUpperCase(), limit: 20 },
      timeout: 5000
    });
    return res.data;
  } catch (err) {
    return { bids: [], asks: [] };
  }
}

async function getFearGreed() {
  try {
    const res = await axios.get('https://api.alternative.me/fng/', {
      params: { limit: 1 }, timeout: 5000
    });
    const d = res.data.data[0];
    const v = parseInt(d.value);
    return {
      value: v, label: d.value_classification,
      isExtremeFear: v<=20, isFear: v>20&&v<=40,
      isNeutral: v>40&&v<=60, isGreed: v>60&&v<=80, isExtremeGreed: v>80
    };
  } catch (err) {
    return { value:50, label:'Neutral', isExtremeFear:false, isFear:false, isNeutral:true, isGreed:false, isExtremeGreed:false };
  }
}

module.exports = {
  getTRYCoins,
  getOHLCV,
  get24hTicker,
  getAllFutures24hTickers,
  getMarkPricesBulk,
  getOrderBook,
  getFearGreed,
  getUSDTRY,
  getTryPairBookMap,
  getTryBookForBase,
  bekle,
  DELAY
};