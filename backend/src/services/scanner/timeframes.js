const { CONFIG } = require('./config');
const L = () => CONFIG.OHLCV_LIMITS;
const gap = () => CONFIG.OHLCV_REQUEST_GAP_MS || 250;

async function getMultiTimeframe(pair, deps) {
  const { binance, indicators } = deps;
  const lim = L();
  const g = gap();
  try {
    const c1d = await binance.getOHLCV(pair, '1d', lim['1d']);
    await binance.bekle(g);
    const c4h = await binance.getOHLCV(pair, '4h', lim['4h']);
    await binance.bekle(g);
    const c1h = await binance.getOHLCV(pair, '1h', lim['1h']);
    await binance.bekle(g);
    const c15m = await binance.getOHLCV(pair, '15m', lim['15m']);

    return {
      d1: c1d.length >= 50 ? indicators.analyzeCandles(c1d) : null,
      h4: c4h.length >= 50 ? indicators.analyzeCandles(c4h) : null,
      h1: c1h.length >= 50 ? indicators.analyzeCandles(c1h) : null,
      m15: c15m.length >= 50 ? indicators.analyzeCandles(c15m) : null
    };
  } catch (err) {
    return { d1: null, h4: null, h1: null, m15: null };
  }
}

function getTimeframeDirections(tf) {
  const dir = (a) => {
    if (!a) return 0;
    if (a.score > 0) return 1;
    if (a.score < 0) return -1;
    return 0;
  };

  const dir15m = dir(tf.m15);
  const dir1h = dir(tf.h1);
  const dir4h = dir(tf.h4);
  const dir1d = dir(tf.d1);

  const allAligned = dir15m === dir1h && dir1h === dir4h && dir4h === dir1d && dir1d !== 0;
  const threeAligned = dir15m === dir1h && dir1h === dir4h && dir4h !== 0;
  const momentumBoost = allAligned ? 3 : threeAligned ? 1 : 0;
  const mtfKonfirm = (dir4h > 0 && dir1h > 0) || allAligned;
  const mtfScore = dir1d * 4 + dir4h * 3 + dir1h * 2 + dir15m;

  return { dir15m, dir1h, dir4h, dir1d, allAligned, momentumBoost, mtfKonfirm, mtfScore };
}

function hasDirectionConflict(dirs) {
  if (dirs.dir1h > 0 && dirs.dir4h < 0) return true;
  if (dirs.dir1h > 0 && dirs.dir1d < 0) return true;
  return false;
}

module.exports = { getMultiTimeframe, getTimeframeDirections, hasDirectionConflict };
