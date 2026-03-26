/**
 * Bitcoin (BTCUSDT) piyasa nabzı — USDT-M perpetual, periyodik tam MTF özeti.
 * Tarama döngüsünden bağımsız; 7/24 arka planda güncellenir.
 * BTC_PULSE_INTERVAL_MS: varsayılan 120000 (ms), minimum 60000.
 */

const binance = require('./binance');
const indicators = require('../indicators');
const { getMultiTimeframe, getTimeframeDirections } = require('./scanner/timeframes');
const { resolveRegime } = require('./scanner/scoring');
const { analyzeOrderBook } = require('./scanner/orderBook');

const BTC_PAIR = 'BTCUSDT';

const INTERVAL_MS = (() => {
  const n = parseInt(process.env.BTC_PULSE_INTERVAL_MS, 10);
  if (Number.isFinite(n) && n >= 60000) return Math.min(n, 600000);
  return 120000;
})();

let snapshot = null;
let lastError = null;
let pulseTimer = null;
const subscribers = [];

function getBtcSnapshot() {
  if (!snapshot) {
    return {
      ok: false,
      symbol: BTC_PAIR,
      currency: 'USDT',
      message: 'Henüz nabız verisi yok; birkaç saniye içinde güncellenecek.',
      lastError,
      updatedAt: null,
      nextRefreshMs: INTERVAL_MS
    };
  }
  return {
    ...snapshot,
    nextRefreshMs: INTERVAL_MS
  };
}

function broadcast() {
  const payload = {
    type: 'btc_pulse',
    data: getBtcSnapshot(),
    time: new Date().toISOString()
  };
  subscribers.forEach((cb) => {
    try {
      cb(payload);
    } catch (_) {
      /* ignore */
    }
  });
}

/** @returns {Promise<{ ok: boolean, error?: string }>} */
async function refreshBtcPulse() {
  try {
    const [sentiment, ticker] = await Promise.all([
      binance.getFearGreed(),
      binance.get24hTicker(BTC_PAIR)
    ]);

    const tf = await getMultiTimeframe(BTC_PAIR, { binance, indicators });
    if (!tf.h1) {
      throw new Error('BTC 1h analizi alınamadı');
    }

    const dirs = getTimeframeDirections(tf);
    const priceChange24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;
    const lastPrice =
      ticker && Number.isFinite(parseFloat(ticker.lastPrice))
        ? parseFloat(ticker.lastPrice)
        : tf.h1.lastClose;

    const { regime, regimeScore } = resolveRegime(tf, priceChange24h);
    const depth = await binance.getOrderBook(BTC_PAIR);
    const orderBook = analyzeOrderBook(depth);

    snapshot = {
      ok: true,
      symbol: BTC_PAIR,
      currency: 'USDT',
      lastPrice,
      lastClose: tf.h1.lastClose,
      priceChange24h,
      quoteVolume24h:
        ticker && ticker.quoteVolume != null ? parseFloat(ticker.quoteVolume) : null,
      high24h: ticker && ticker.highPrice != null ? parseFloat(ticker.highPrice) : null,
      low24h: ticker && ticker.lowPrice != null ? parseFloat(ticker.lowPrice) : null,
      sentiment,
      regime: { type: regime, regimeScore },
      mtf: {
        dir15m: dirs.dir15m,
        dir1h: dirs.dir1h,
        dir4h: dirs.dir4h,
        dir1d: dirs.dir1d,
        allAligned: dirs.allAligned,
        mtfKonfirm: dirs.mtfKonfirm,
        mtfScore: dirs.mtfScore,
        momentumBoost: dirs.momentumBoost
      },
      h1: {
        score: tf.h1.score,
        overallSignal: tf.h1.overallSignal,
        signalStrength: tf.h1.signalStrength,
        rsi: tf.h1.rsi,
        trend: tf.h1.trend,
        macdHistogram: tf.h1.macd?.histogram,
        anomaly: {
          isAnomaly: tf.h1.anomaly?.isAnomaly,
          signal: tf.h1.anomaly?.signal,
          zScore: tf.h1.anomaly?.zScore,
          reason: tf.h1.anomaly?.reason
        },
        atrPercent: tf.h1.atr?.atrPercent,
        tp1Pct: tf.h1.atr?.tp1Pct,
        tp3Pct: tf.h1.atr?.tp3Pct,
        stopLoss: tf.h1.atr?.stopLoss,
        takeProfit1: tf.h1.atr?.takeProfit1
      },
      orderBook: {
        orderFlowScore: orderBook.orderFlowScore,
        bidAskRatio: orderBook.bidAskRatio,
        bullish: orderBook.bullish,
        bearish: orderBook.bearish
      },
      updatedAt: new Date().toISOString(),
      pulseError: null,
      pulseErrorAt: null
    };
    lastError = null;
    broadcast();
    return { ok: true };
  } catch (err) {
    lastError = err.message;
    console.error('BTC pulse:', err.message);
    if (snapshot && snapshot.ok) {
      snapshot = {
        ...snapshot,
        pulseError: err.message,
        pulseErrorAt: new Date().toISOString()
      };
    }
    broadcast();
    return { ok: false, error: err.message };
  }
}

function subscribe(cb) {
  subscribers.push(cb);
}

function startBtcPulse(io) {
  if (pulseTimer) return;

  if (io) {
    subscribe((payload) => io.emit('btc_pulse', payload));
  }

  setTimeout(() => {
    refreshBtcPulse();
  }, 2500);

  pulseTimer = setInterval(refreshBtcPulse, INTERVAL_MS);
  console.log(`BTC nabız: ${BTC_PAIR} — her ${INTERVAL_MS / 1000}s güncelleme`);
}

module.exports = {
  startBtcPulse,
  refreshBtcPulse,
  getBtcSnapshot,
  subscribe,
  BTC_PAIR,
  INTERVAL_MS
};
