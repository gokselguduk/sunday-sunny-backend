const binance = require('./binance');

const CACHE_MS = Number(process.env.WINNER_PATTERN_CACHE_MS) || 3 * 60 * 60 * 1000;
const BETWEEN_MS = Number(process.env.WINNER_PATTERN_DELAY_MS) || 380;

let cache = { at: 0, payload: null, error: null };

function median(arr) {
  const a = [...arr].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function stdDev(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  if (a.length < 2) return 1;
  const mu = a.reduce((s, x) => s + x, 0) / a.length;
  const v = a.reduce((s, x) => s + (x - mu) ** 2, 0) / a.length;
  return Math.sqrt(v) || 1;
}

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gains += ch;
    else losses -= ch;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

/**
 * Günlük mumlar üzerinde [startIdx..endIdx] (dahil) penceresi için metrikler.
 * endIdx >= startIdx, startIdx >= 1
 */
function windowMetrics(candles, endIdx, winLen) {
  const startIdx = endIdx - winLen + 1;
  if (startIdx < 1 || endIdx >= candles.length) return null;

  let sumR = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const prev = candles[i - 1].close;
    if (!prev) return null;
    sumR += (candles[i].close - prev) / prev;
  }
  const meanRet = sumR / winLen;

  const base = candles[startIdx - 1].close;
  const cumRet = base > 0 ? (candles[endIdx].close - base) / base : 0;

  let sumRg = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i].close;
    if (!c) return null;
    sumRg += (candles[i].high - candles[i].low) / c;
  }
  const rangeAvg = sumRg / winLen;

  const volSlice = [];
  for (let j = Math.max(1, endIdx - 19); j <= endIdx; j++) {
    volSlice.push(candles[j].volume);
  }
  const medV = median(volSlice);
  const volRatio = medV > 0 ? candles[endIdx].volume / medV : 1;

  const closes = candles.slice(0, endIdx + 1).map((c) => c.close);
  const rsiEnd = calcRSI(closes, 14);

  return { meanRet, cumRet, rangeAvg, volRatio, rsiEnd };
}

function findBestUpDayIndex(candles) {
  let bestI = -1;
  let bestR = -Infinity;
  for (let i = 6; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    if (!prev) continue;
    const r = (candles[i].close - prev) / prev;
    if (r > bestR) {
      bestR = r;
      bestI = i;
    }
  }
  return { bestI, bestR };
}

function returnOverWindow(candles) {
  if (candles.length < 2) return null;
  const a = candles[0].close;
  const b = candles[candles.length - 1].close;
  if (!a || !b) return null;
  return ((b - a) / a) * 100;
}

function similarityScore(vec, med, sig) {
  const keys = ['meanRet', 'cumRet', 'rangeAvg', 'volRatio', 'rsiEnd'];
  let sumSq = 0;
  let n = 0;
  for (const k of keys) {
    const sigma = sig[k] > 1e-12 ? sig[k] : 1;
    const z = (vec[k] - med[k]) / sigma;
    sumSq += z * z;
    n++;
  }
  const dist = Math.sqrt(sumSq / n);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.min(1, dist / 5)))));
}

function statsFromProfiles(profiles) {
  const keys = ['meanRet', 'cumRet', 'rangeAvg', 'volRatio', 'rsiEnd'];
  const med = {};
  const sig = {};
  for (const k of keys) {
    med[k] = median(profiles.map((p) => p[k]));
    sig[k] = stdDev(profiles.map((p) => p[k]));
  }
  return { med, sig };
}

/**
 * TR + USDT-M listesi üzerinde 100 günlük getiri sıralaması ve
 * büyük yükseliş gününden önceki 5 günlük davranışın medyan profili ile
 * güncel 5 günlük profili karşılaştırır.
 */
async function computeWinnerPatternAnalysis(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cache.payload && now - cache.at < CACHE_MS) {
    return { ...cache.payload, cached: true };
  }

  const started = Date.now();
  const coins = await binance.getTRYCoins();
  const winLen = 5;
  const limit = 102;

  const bySymbol = new Map();

  for (const c of coins) {
    try {
      const candles = await binance.getOHLCV(c.pair, '1d', limit);
      if (!candles || candles.length < 30) {
        await binance.bekle(BETWEEN_MS);
        continue;
      }
      const ret100 = returnOverWindow(candles);
      if (ret100 == null || !Number.isFinite(ret100)) {
        await binance.bekle(BETWEEN_MS);
        continue;
      }
      const { bestI, bestR } = findBestUpDayIndex(candles);
      let preProfile = null;
      if (bestI >= winLen + 1) {
        preProfile = windowMetrics(candles, bestI - 1, winLen);
      }
      const endNow = candles.length - 1;
      const currentProfile =
        endNow >= winLen ? windowMetrics(candles, endNow, winLen) : null;

      bySymbol.set(c.pair, {
        candles,
        return100d: ret100,
        bestDayReturn: bestR,
        preProfile,
        currentProfile
      });
    } catch (e) {
      /* atla */
    }
    await binance.bekle(BETWEEN_MS);
  }

  const ranked = [...bySymbol.entries()]
    .map(([sym, d]) => ({ symbol: sym, ...d }))
    .filter((d) => Number.isFinite(d.return100d))
    .sort((a, b) => b.return100d - a.return100d);

  const topN = 25;
  const topGainers = ranked.slice(0, topN).map((d) => ({
    symbol: d.symbol,
    return100d: Math.round(d.return100d * 100) / 100,
    bestDayReturnPct: Math.round((d.bestDayReturn || 0) * 10000) / 100
  }));

  const winnerProfiles = ranked
    .slice(0, topN)
    .map((d) => d.preProfile)
    .filter(Boolean);
  let archetype = null;
  let peers = [];

  if (winnerProfiles.length >= 5) {
    const { med, sig } = statsFromProfiles(winnerProfiles);
    archetype = {
      median: {
        meanRet: Math.round(med.meanRet * 10000) / 10000,
        cumRet: Math.round(med.cumRet * 10000) / 10000,
        rangeAvg: Math.round(med.rangeAvg * 10000) / 10000,
        volRatio: Math.round(med.volRatio * 100) / 100,
        rsiEnd: Math.round(med.rsiEnd * 10) / 10
      },
      sampleWinners: winnerProfiles.length
    };

    peers = ranked
      .map((d) => {
        if (!d.currentProfile) return null;
        const sim = similarityScore(d.currentProfile, med, sig);
        return {
          symbol: d.symbol,
          similarity: sim,
          return100d: Math.round(d.return100d * 100) / 100,
          features: {
            meanRet5d: Math.round(d.currentProfile.meanRet * 10000) / 10000,
            cumRet5d: Math.round(d.currentProfile.cumRet * 10000) / 10000,
            rangeAvg: Math.round(d.currentProfile.rangeAvg * 10000) / 10000,
            volRatio: Math.round(d.currentProfile.volRatio * 100) / 100,
            rsi: Math.round(d.currentProfile.rsiEnd * 10) / 10
          }
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity);
  }

  const topGainerSet = new Set(topGainers.map((g) => g.symbol));
  const similarNow = peers
    .filter((p) => !topGainerSet.has(p.symbol))
    .filter((p) => p.similarity >= 55)
    .slice(0, 35);

  const payload = {
    ok: true,
    cached: false,
    updatedAt: new Date().toISOString(),
    days: 100,
    symbolCount: bySymbol.size,
    durationMs: Date.now() - started,
    topGainers,
    archetype,
    similarNow,
    note:
      'Üst sıradaki coinler son ~100 gündeki toplam USDT-M günlük getiriye göre sıralanır. Benzerlik, her birinde en güçlü yükseliş gününden *önceki* 5 günün ortak profili ile şu anki son 5 gününü karşılaştırır; yatırım tavsiyesi değildir.'
  };

  cache = { at: Date.now(), payload, error: null };
  return payload;
}

function getCachedWinnerPattern() {
  if (cache.payload) return { ...cache.payload, cached: true };
  return null;
}

module.exports = {
  computeWinnerPatternAnalysis,
  getCachedWinnerPattern
};
