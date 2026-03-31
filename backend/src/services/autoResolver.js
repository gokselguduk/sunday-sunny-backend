const memory = require('./memory');
const binance = require('./binance');

const RESOLVED = new Set(['TP1', 'TP2', 'TP3', 'SL']);

function resolveResult(signal, currentPrice) {
  if (!signal || !currentPrice) return null;
  if (RESOLVED.has(signal.result)) return null;

  const tp3 = Number(signal.tp3) || 0;
  const tp2 = Number(signal.tp2) || 0;
  const tp1 = Number(signal.tp1) || 0;
  const sl = Number(signal.sl) || 0;

  if (tp3 > 0 && currentPrice >= tp3) return 'TP3';
  if (tp2 > 0 && currentPrice >= tp2) return 'TP2';
  if (tp1 > 0 && currentPrice >= tp1) return 'TP1';
  if (sl > 0 && currentPrice <= sl) return 'SL';
  return null;
}

async function resolvePendingSignals() {
  const pending = await memory.listPendingSignals(2500);
  if (!pending.length) return { checked: 0, resolved: 0 };

  let tickers = {};
  try {
    tickers = await binance.getAllFutures24hTickers();
  } catch (_) {
    tickers = {};
  }
  if (!tickers || typeof tickers !== 'object') {
    return { checked: pending.length, resolved: 0, error: 'TICKERS_UNAVAILABLE' };
  }

  let resolved = 0;
  for (const signal of pending) {
    try {
      const row = tickers[signal.symbol];
      const currentPrice = row?.lastPrice;
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;
      const result = resolveResult(signal, currentPrice);
      if (!result) continue;
      await memory.updateSignalResult(signal.key, result, currentPrice);
      resolved += 1;
    } catch (err) {
      // best-effort
    }
  }
  return { checked: pending.length, resolved };
}

module.exports = { resolvePendingSignals };
