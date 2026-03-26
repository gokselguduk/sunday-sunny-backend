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
  const pending = await memory.listPendingSignals(1500);
  if (!pending.length) return { checked: 0, resolved: 0 };

  let resolved = 0;
  for (const signal of pending) {
    try {
      const ticker = await binance.get24hTicker(signal.symbol);
      const currentPrice = parseFloat(ticker?.lastPrice || ticker?.last || 0);
      const result = resolveResult(signal, currentPrice);
      if (!result) continue;
      await memory.updateSignalResult(signal.key, result, currentPrice);
      resolved += 1;
    } catch (err) {
      // best-effort resolver, skip faulty symbols
    }
  }
  return { checked: pending.length, resolved };
}

module.exports = { resolvePendingSignals };
