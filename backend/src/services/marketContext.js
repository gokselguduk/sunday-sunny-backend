/**
 * Geniş piyasa bağlamı: funding, OI, spot–perp baz, seans profili, DXY karşılaştırması,
 * isteğe bağlı likidasyon (Coinglass), BTC ağı ücretleri (mempool.space).
 * Önbellekli; skor motorundan bağımsız bilgi amaçlı.
 */

const axios = require('axios');
const binance = require('./binance');

const FAPI = 'https://fapi.binance.com/fapi/v1';
const FDATA = 'https://fapi.binance.com/futures/data';
const SPOT = 'https://api.binance.com/api/v3';

const SYMBOL = 'BTCUSDT';
const TTL_MS = Math.max(30000, Math.min(parseInt(process.env.MARKET_CONTEXT_CACHE_MS, 10) || 90000, 300000));

let cache = { json: null, at: 0 };

async function getJson(url, config = {}) {
  try {
    const res = await axios.get(url, { timeout: 9000, ...config });
    return res.data;
  } catch (_) {
    return null;
  }
}

async function fetchCoinglassLiquidations() {
  const key = process.env.COINGLASS_API_KEY;
  if (!key) {
    return {
      configured: false,
      note: 'Harici likidasyon kümeleri için COINGLASS_API_KEY (Coinglass) ekleyebilirsin.'
    };
  }
  try {
    const res = await axios.get('https://open-api.coinglass.com/public/v2/indicator/liquidation_chart', {
      headers: { coinglassSecret: key },
      params: { symbol: 'BTC', interval: '1d' },
      timeout: 8000
    });
    const d = res.data?.data;
    return { configured: true, summary: d || res.data };
  } catch (e) {
    return { configured: true, error: e.message };
  }
}

async function fetchYahooDxy() {
  try {
    const url =
      'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=10d';
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SundaySunny/1.0; +https://github.com)' }
    });
    const r = res.data?.chart?.result?.[0];
    if (!r) return null;
    const closes = (r.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
    const last = closes.length ? closes[closes.length - 1] : null;
    const prev = closes.length >= 2 ? closes[closes.length - 2] : r.meta?.previousClose;
    const chgPct = last != null && prev ? ((last - prev) / prev) * 100 : null;
    return {
      label: 'DXY (Yahoo)',
      last,
      change1dPct: chgPct != null ? Math.round(chgPct * 100) / 100 : null
    };
  } catch (_) {
    return null;
  }
}

async function fetchMempoolBtc() {
  const fees = await getJson('https://mempool.space/api/v1/fees/recommended');
  if (!fees) return { ok: false, note: 'mempool.space erişilemedi' };
  return {
    ok: true,
    fastestSatVb: fees.fastestFee,
    halfHourSatVb: fees.halfHourFee,
    hourSatVb: fees.hourFee,
    note: 'BTC ağı işlem ücreti (sat/vB); borsa giriş-çıkış değil.'
  };
}

function sessionFromHourlyKlines(klines) {
  if (!klines?.length) return null;
  const byHour = Array.from({ length: 24 }, () => ({ n: 0, sumRange: 0 }));
  for (const k of klines) {
    const h = new Date(k.time).getUTCHours();
    const o = k.open > 0 ? k.open : k.close;
    const rangePct = o > 0 ? ((k.high - k.low) / o) * 100 : 0;
    byHour[h].n += 1;
    byHour[h].sumRange += rangePct;
  }
  const rows = byHour.map((x, hour) => ({
    hourUtc: hour,
    avgRangePct: x.n ? Math.round((x.sumRange / x.n) * 1000) / 1000 : 0
  }));
  const nonzero = rows.filter((r) => r.avgRangePct > 0);
  const hi = [...nonzero].sort((a, b) => b.avgRangePct - a.avgRangePct).slice(0, 3);
  const lo = [...nonzero].sort((a, b) => a.avgRangePct - b.avgRangePct).slice(0, 3);
  return {
    window: 'Son ~7 gün, saatlik (1h) mum — BTCUSDT perp',
    volatileUtcHours: hi,
    calmUtcHours: lo,
    hint: 'UTC+3 = Türkiye (yaz/kış farkı olabilir). Yüksek ort. aralık = o saatte volatilite eğilimi.'
  };
}

function riskRegimeNarrative(btcChg, dxyChg) {
  if (btcChg == null || dxyChg == null) return null;
  const same = (btcChg >= 0 && dxyChg <= 0) || (btcChg <= 0 && dxyChg >= 0);
  return {
    btc24hPct: Math.round(btcChg * 100) / 100,
    dxy1dPct: Math.round(dxyChg * 100) / 100,
    typicalRiskOn: same && btcChg > 0 && dxyChg < 0,
    note:
      'Kaba çerçeve: güçlü dolar (DXY↑) bazen riskten kaçışla birlikte okunur; kripto ile kısa vadeli ilişki her zaman tutmaz.'
  };
}

async function buildSnapshot() {
  const updatedAt = new Date().toISOString();

  const [premium, oiNow, oiHist, spotTicker, perpTicker, klines, dxy, mempool, coinglass, takerRatio] =
    await Promise.all([
      getJson(`${FAPI}/premiumIndex`, { params: { symbol: SYMBOL } }),
      getJson(`${FAPI}/openInterest`, { params: { symbol: SYMBOL } }),
      getJson(`${FDATA}/openInterestHist`, { params: { symbol: SYMBOL, period: '1h', limit: 5 } }),
      getJson(`${SPOT}/ticker/24hr`, { params: { symbol: SYMBOL } }),
      getJson(`${FAPI}/ticker/24hr`, { params: { symbol: SYMBOL } }),
      binance.getOHLCV(SYMBOL, '1h', 168).catch(() => []),
      fetchYahooDxy(),
      fetchMempoolBtc(),
      fetchCoinglassLiquidations(),
      getJson(`${FDATA}/takerlongshortRatio`, { params: { symbol: SYMBOL, period: '1d', limit: 1 } })
    ]);

  const mark = premium ? parseFloat(premium.markPrice) : null;
  const indexPx = premium ? parseFloat(premium.indexPrice) : null;
  const spotLast = spotTicker ? parseFloat(spotTicker.lastPrice) : null;
  const fundingRate = premium != null ? parseFloat(premium.lastFundingRate) : null;
  const nextFundingTime = premium?.nextFundingTime || null;

  let basisSpotPerpPct = null;
  if (spotLast > 0 && mark > 0) {
    basisSpotPerpPct = Math.round(((mark - spotLast) / spotLast) * 10000) / 100;
  }

  let markIndexBasisPct = null;
  if (indexPx > 0 && mark > 0) {
    markIndexBasisPct = Math.round(((mark - indexPx) / indexPx) * 10000) / 100;
  }

  const oiVal = oiNow ? parseFloat(oiNow.openInterest) : null;
  let oiChange1hPct = null;
  if (Array.isArray(oiHist) && oiHist.length >= 2) {
    const a = parseFloat(oiHist[oiHist.length - 1]?.sumOpenInterest);
    const b = parseFloat(oiHist[oiHist.length - 2]?.sumOpenInterest);
    if (a > 0 && b > 0) oiChange1hPct = Math.round(((a - b) / b) * 10000) / 100;
  }

  const btc24hChg = perpTicker != null ? parseFloat(perpTicker.priceChangePercent) : null;

  const taker = Array.isArray(takerRatio) && takerRatio[0] ? takerRatio[0] : null;
  const buySellRatio = taker ? parseFloat(taker.buySellRatio) : null;

  return {
    ok: true,
    symbol: SYMBOL,
    updatedAt,
    funding: {
      lastFundingRate: fundingRate,
      approxPctPerPeriod:
        fundingRate != null ? Math.round(fundingRate * 10000) / 100 : null,
      nextFundingTime,
      note: 'Pozitif: long’lar short’lara öder (yaklaşık 8 saatlik periyot; yorum bağlama).'
    },
    openInterest: {
      contracts: oiVal,
      change1hPct: oiChange1hPct,
      note: 'OI artışı + yön tek başına squeeze veya trend devamı anlamına gelmez.'
    },
    basis: {
      spotLast,
      perpMark: mark,
      indexPrice: indexPx,
      spotPerpPremiumPct: basisSpotPerpPct,
      markIndexBasisPct,
      note: 'Spot–perp farkı; taşınma/stres dönemlerinde genişleyebilir.'
    },
    perp24h: perpTicker
      ? {
          priceChangePercent: btc24hChg,
          quoteVolume: parseFloat(perpTicker.quoteVolume)
        }
      : null,
    takerFlow: buySellRatio != null
      ? {
          buySellRatio,
          hint: buySellRatio > 1 ? 'Taker alım hacmi satıma göre yüksek (1g)' : 'Taker satım hacmi alıma göre yüksek veya dengede (1g)'
        }
      : null,
    session: sessionFromHourlyKlines(klines),
    macro: {
      dxy: dxy,
      narrative: riskRegimeNarrative(btc24hChg, dxy?.change1dPct)
    },
    onchainBtc: mempool,
    liquidations: coinglass,
    disclaimer: 'Yatırım tavsiyesi değildir; bağlam verisidir.'
  };
}

async function getMarketContext(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cache.json && now - cache.at < TTL_MS) {
    return { ...cache.json, cached: true, cacheAgeMs: now - cache.at };
  }
  try {
    const json = await buildSnapshot();
    cache = { json, at: now };
    return { ...json, cached: false, cacheAgeMs: 0 };
  } catch (e) {
    const err = { ok: false, error: e.message, updatedAt: new Date().toISOString() };
    return err;
  }
}

module.exports = { getMarketContext, buildSnapshot };
