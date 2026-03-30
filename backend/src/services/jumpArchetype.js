/**
 * Tüm TR USDT-M paritelerinde, seçilen günlük sıçrama eşiğini geçen günlerin
 * hemen öncesindeki 5 işlem günü profillerinden küresel arketip çıkarır;
 * şu anki son 5 günü bu arketipe yakın olanları sıralar.
 * Geçmişteki benzer profillerde görülen sıçrama büyüklüğünün medyanı "vaat" metriği olarak verilir (garanti değildir).
 */
const binance = require('./binance');

const CACHE_MS = Number(process.env.JUMP_ARCHETYPE_CACHE_MS) || 3 * 60 * 60 * 1000;
const BETWEEN_MS = Number(process.env.WINNER_PATTERN_DELAY_MS) || 380;
const LOOKBACK_DAYS = Math.min(
  1500,
  Math.max(180, Math.floor(Number(process.env.JUMP_ARCHETYPE_LOOKBACK_DAYS || process.env.WINNER_PATTERN_LOOKBACK_DAYS) || 730))
);
/** Tek günlük kapanış hareketi bu oranın üstündeyse "sıçrama" sayılır (yüzde cinsinden, örn. 8 = %8). */
const SPIKE_MIN_DAY_PCT = Math.min(35, Math.max(4, Number(process.env.JUMP_ARCHETYPE_MIN_DAY_PCT) || 8));
const SIM_DIST_SCALE = Math.max(3.2, Math.min(6, Number(process.env.JUMP_ARCHETYPE_SIM_DIST_SCALE) || 4.2));
const MIN_SIMILARITY = Math.min(95, Math.max(52, Number(process.env.JUMP_ARCHETYPE_MIN_SIMILARITY) || 62));
const MIN_STRUCTURAL_HITS = Math.min(5, Math.max(1, Number(process.env.JUMP_ARCHETYPE_MIN_HITS) || 2));
const HIGH_SIM_ESCAPE = Math.min(92, Math.max(70, Number(process.env.JUMP_ARCHETYPE_HIGH_SIM_ESCAPE) || 72));
const MAX_LISTED = Math.min(60, Math.max(6, Number(process.env.JUMP_ARCHETYPE_MAX_MATCHES) || 22));
const MIN_TRAINING_SAMPLES = Math.max(40, Math.floor(Number(process.env.JUMP_ARCHETYPE_MIN_SAMPLES) || 80));
const PROMISE_PEER_SIM_GAP = Math.min(25, Math.max(5, Number(process.env.JUMP_ARCHETYPE_PROMISE_GAP) || 14));

let cache = { at: 0, payload: null };

function median(arr) {
  const a = [...arr].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function percentile(arr, p) {
  const a = [...arr].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const idx = Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * (a.length - 1))));
  return a[idx];
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
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.min(1, dist / SIM_DIST_SCALE)))));
}

function countStructuralHits(vec, med) {
  if (!vec || !med) return 0;
  let n = 0;
  const vC = vec.cumRet;
  const mC = med.cumRet;
  if (Number.isFinite(vC) && Number.isFinite(mC) && Math.abs(vC - mC) < Math.max(0.025, Math.abs(mC) * 0.5 + 0.012)) {
    n++;
  }
  if (vec.volRatio >= med.volRatio * 0.8) n++;
  if (vec.rsiEnd >= med.rsiEnd - 18 && vec.rsiEnd <= med.rsiEnd + 25) n++;
  if (vec.rangeAvg >= med.rangeAvg * 0.85) n++;
  if (vec.meanRet >= med.meanRet - 0.0025) n++;
  return n;
}

function hasMeaningfulRecentStructure(vec, med) {
  if (!vec || !med) return true;
  const flat =
    Math.abs(vec.cumRet) < 0.0025 &&
    vec.volRatio < 0.9 &&
    vec.rangeAvg < med.rangeAvg * 0.65 &&
    Math.abs(vec.meanRet) < 0.0009;
  return !flat;
}

function spikePromiseFromTraining(enriched, candidateSim) {
  const floor = candidateSim - PROMISE_PEER_SIM_GAP;
  const peers = enriched.filter((t) => t.simToArchetype >= floor);
  const returnsPct = peers.length >= 8 ? peers.map((t) => t.spikeReturn * 100) : enriched.map((t) => t.spikeReturn * 100);
  const m = median(returnsPct);
  const p75 = percentile(returnsPct, 75);
  const n = peers.length >= 8 ? peers.length : enriched.length;
  return {
    medianSpikePct: Math.round(m * 100) / 100,
    p75SpikePct: Math.round(p75 * 100) / 100,
    basedOnSamples: n
  };
}

async function computeJumpArchetypeAnalysis(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cache.payload && now - cache.at < CACHE_MS) {
    return { ...cache.payload, cached: true };
  }

  const started = Date.now();
  const coins = await binance.getTRYCoins();
  const winLen = 5;
  const limit = Math.min(1500, LOOKBACK_DAYS + 40);
  const spikeTh = SPIKE_MIN_DAY_PCT / 100;

  /** @type {{symbol:string,profile:object,spikeReturn:number,simToArchetype?:number}[]} */
  const training = [];
  const bySymbol = new Map();

  for (const c of coins) {
    try {
      const candles = await binance.getOHLCV(c.pair, '1d', limit);
      if (!candles || candles.length < winLen + 8) {
        await binance.bekle(BETWEEN_MS);
        continue;
      }
      const endNow = candles.length - 1;
      const currentProfile = endNow >= winLen ? windowMetrics(candles, endNow, winLen) : null;
      bySymbol.set(c.pair, { candles, currentProfile });

      for (let i = 6; i < candles.length; i++) {
        const prev = candles[i - 1].close;
        if (!prev) continue;
        const r = (candles[i].close - prev) / prev;
        if (r < spikeTh) continue;
        const pre = windowMetrics(candles, i - 1, winLen);
        if (!pre) continue;
        training.push({ symbol: c.pair, profile: pre, spikeReturn: r });
      }
    } catch (e) {
      /* atla */
    }
    await binance.bekle(BETWEEN_MS);
  }

  if (training.length < MIN_TRAINING_SAMPLES) {
    return {
      ok: false,
      error: 'Yetersiz örnek',
      detailTr: `Seçilen pencerede ve ≥%${SPIKE_MIN_DAY_PCT} günlük sıçrama eşiğinde yalnızca ${training.length} olay bulundu (minimum ${MIN_TRAINING_SAMPLES}). Eşiği düşürmek için JUMP_ARCHETYPE_MIN_DAY_PCT kullanın.`,
      trainingSamples: training.length,
      lookbackDays: LOOKBACK_DAYS,
      spikeMinDayPct: SPIKE_MIN_DAY_PCT
    };
  }

  const profiles = training.map((t) => t.profile);
  const { med, sig } = statsFromProfiles(profiles);
  const enriched = training.map((t) => ({
    ...t,
    simToArchetype: similarityScore(t.profile, med, sig)
  }));

  const allSpikePcts = enriched.map((t) => t.spikeReturn * 100);
  const globalMedianSpike = median(allSpikePcts);
  const globalP75Spike = percentile(allSpikePcts, 75);
  const uniqueSyms = new Set(enriched.map((t) => t.symbol)).size;

  const archetype = {
    median: {
      meanRet: Math.round(med.meanRet * 10000) / 10000,
      cumRet: Math.round(med.cumRet * 10000) / 10000,
      rangeAvg: Math.round(med.rangeAvg * 10000) / 10000,
      volRatio: Math.round(med.volRatio * 100) / 100,
      rsiEnd: Math.round(med.rsiEnd * 10) / 10
    },
    trainingEvents: enriched.length,
    distinctPairs: uniqueSyms,
    spikeMinDayPct: SPIKE_MIN_DAY_PCT,
    historicalMedianSpikePct: Math.round(globalMedianSpike * 100) / 100,
    historicalP75SpikePct: Math.round(globalP75Spike * 100) / 100
  };

  const narrativeTr =
    `Son **${LOOKBACK_DAYS} gün** ve **${uniqueSyms}** paritede toplam **${enriched.length}** adet günlük sıçrama (≥**%${SPIKE_MIN_DAY_PCT}** tek gün kapanış hareketi) tarandı. ` +
    `Her sıçramadan hemen önceki **5 işlem gününün** ortak özeti aşağıdaki teknik medyandır. ` +
    `Geçmişte bu havuzdaki sıçramaların tipik büyüklüğü: medyan **%${archetype.historicalMedianSpikePct}**, üst çeyrek **%${archetype.historicalP75SpikePct}**. ` +
    `Liste: şu anki son 5 günü bu küresel profile yakın olan pariteler; “vaat” sütunu, geçmişte benzer profile sahip olaylarda görülen sıçrama büyüklüğünün medyanıdır (gelecek garantisi değildir). Zaman: **günlük mum** — tanım gereği sıçrama, 5 günlük pencerenin **ertesi işlem gününde** ölçüldü.`;

  const horizonNoteTr =
    'Çözünürlük günlük; saatlik veya anlık sıçrama bu modelde yok. Geçmiş örneklerde olay, 5 günlük kurulumu takip eden ilk güçlü yeşil gün olarak etiketlendi.';

  const peers = [];
  for (const [sym, row] of bySymbol.entries()) {
    const cp = row.currentProfile;
    if (!cp) continue;
    const sim = similarityScore(cp, med, sig);
    const hits = countStructuralHits(cp, med);
    const prom = spikePromiseFromTraining(enriched, sim);
    peers.push({
      symbol: sym,
      similarity: sim,
      structuralHits: hits,
      spikePromisePct: prom.medianSpikePct,
      spikePromiseP75Pct: prom.p75SpikePct,
      promiseSampleSize: prom.basedOnSamples,
      features: {
        meanRet5d: Math.round(cp.meanRet * 10000) / 10000,
        cumRet5d: Math.round(cp.cumRet * 10000) / 10000,
        rangeAvg: Math.round(cp.rangeAvg * 10000) / 10000,
        volRatio: Math.round(cp.volRatio * 100) / 100,
        rsi: Math.round(cp.rsiEnd * 10) / 10
      },
      horizonNoteTr
    });
  }

  peers.sort((a, b) => b.similarity - a.similarity);

  const candidates = peers
    .filter((p) => p.similarity >= MIN_SIMILARITY)
    .filter((p) => p.structuralHits >= MIN_STRUCTURAL_HITS || p.similarity >= HIGH_SIM_ESCAPE)
    .filter((p) => {
      const row = bySymbol.get(p.symbol);
      return hasMeaningfulRecentStructure(row?.currentProfile, med);
    })
    .slice(0, MAX_LISTED);

  const methodNoteTr =
    `Tüm TR USDT-M perpetual pariteleri taranır; tek gün kapanış getirisi ≥%${SPIKE_MIN_DAY_PCT} olan her gün bir “sıçrama” kabul edilir ve o günden önceki 5 gün profili havuza eklenir. ` +
    'Arketip, bu havuzun medyan ve sapmasıdır. Vaat: şu anki benzerlik skoruna yakın geçmiş profillerde gerçekleşen sıçrama yüzdelerinin medyanı.';

  const filterSummaryTr =
    `Liste: benzerlik ≥%${MIN_SIMILARITY}, yapı taşı ≥${MIN_STRUCTURAL_HITS} (veya benzerlik ≥%${HIGH_SIM_ESCAPE}), anlamsız yatay 5g elendi; en fazla ${MAX_LISTED} satır. Ortam: JUMP_ARCHETYPE_* .`;

  const payload = {
    ok: true,
    cached: false,
    updatedAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    symbolCount: bySymbol.size,
    durationMs: Date.now() - started,
    narrativeTr: narrativeTr.replace(/\*\*/g, ''),
    methodNoteTr,
    filterSummaryTr,
    horizonNoteTr,
    listFilters: {
      minSimilarity: MIN_SIMILARITY,
      minStructuralHits: MIN_STRUCTURAL_HITS,
      highSimilarityEscape: HIGH_SIM_ESCAPE,
      maxMatches: MAX_LISTED,
      spikeMinDayPct: SPIKE_MIN_DAY_PCT
    },
    archetype,
    candidates,
    note: 'Yatırım tavsiyesi değildir. Geçmiş dağılım geleceği göstermez; likidite ve haber fiyatı değiştirir.'
  };

  cache = { at: Date.now(), payload };
  return payload;
}

function getCachedJumpArchetype() {
  if (cache.payload) return { ...cache.payload, cached: true };
  return null;
}

module.exports = {
  computeJumpArchetypeAnalysis,
  getCachedJumpArchetype
};
