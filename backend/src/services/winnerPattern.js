const binance = require('./binance');

const CACHE_MS = Number(process.env.WINNER_PATTERN_CACHE_MS) || 3 * 60 * 60 * 1000;
const BETWEEN_MS = Number(process.env.WINNER_PATTERN_DELAY_MS) || 380;
/** Günlük mum sayısı (Binance max 1500). Varsayılan ~2 yıl. */
const LOOKBACK_DAYS = Math.min(
  1500,
  Math.max(180, Math.floor(Number(process.env.WINNER_PATTERN_LOOKBACK_DAYS) || 730))
);
/** Benzerlik yüzdesi eşiği (yükselt = daha az sonuç). */
const MIN_SIMILARITY = Math.min(95, Math.max(52, Number(process.env.WINNER_PATTERN_MIN_SIMILARITY) || 64));
/** Z-mesafe ölçeği (düşür = skor daha sıkı, örn. 4.15). */
const SIM_DIST_SCALE = Math.max(3.2, Math.min(6, Number(process.env.WINNER_PATTERN_SIM_DIST_SCALE) || 4.15));
/** En az kaç “yapı taşı” (hacim/RSI/aralık/kümülatif…) eşleşsin. */
const MIN_STRUCTURAL_HITS = Math.min(5, Math.max(1, Number(process.env.WINNER_PATTERN_MIN_HITS) || 2));
/** Bu benzerlik üstüyse daha az yapı taşı yeter. */
const HIGH_SIM_ESCAPE = Math.min(92, Math.max(70, Number(process.env.WINNER_PATTERN_HIGH_SIM_ESCAPE) || 74));
/** Listede en fazla kaç parite. */
const MAX_SIMILAR_LISTED = Math.min(50, Math.max(5, Number(process.env.WINNER_PATTERN_MAX_MATCHES) || 14));

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

function returnOverFullSeries(candles) {
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
  const scale = SIM_DIST_SCALE;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.min(1, dist / scale)))));
}

/** Ralli öncesi profiline kaç ayrı boyutta yakınlık var (0–5). */
function countStructuralHits(vec, med) {
  if (!vec || !med) return 0;
  let n = 0;
  const vC = vec.cumRet;
  const mC = med.cumRet;
  if (Number.isFinite(vC) && Number.isFinite(mC) && Math.abs(vC - mC) < Math.max(0.02, Math.abs(mC) * 0.45 + 0.01)) {
    n++;
  }
  if (vec.volRatio >= med.volRatio * 0.82) n++;
  if (vec.rsiEnd >= med.rsiEnd - 15 && vec.rsiEnd <= med.rsiEnd + 22) n++;
  if (vec.rangeAvg >= med.rangeAvg * 0.88) n++;
  if (vec.meanRet >= med.meanRet - 0.002) n++;
  return n;
}

/** Son 5g tamamen “ölü yatay” ise listeye alma (sadece ortalamaya yakın kalan gürültü). */
function hasMeaningfulRecentStructure(vec, med) {
  if (!vec || !med) return true;
  const flat =
    Math.abs(vec.cumRet) < 0.003 &&
    vec.volRatio < 0.92 &&
    vec.rangeAvg < med.rangeAvg * 0.68 &&
    Math.abs(vec.meanRet) < 0.001;
  return !flat;
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

function buildPatternNarrativeTr(lookbackDays, sampleWinners, med) {
  if (!med || sampleWinners < 5) {
    return `Model, son ${lookbackDays} günlük USDT-M günlük mumları kullanır. Yeterli “yüksek getiri + ralli öncesi 5 gün” örneği oluşunca özet burada görünür.`;
  }
  const mr = (med.meanRet * 100).toFixed(3);
  const cr = (med.cumRet * 100).toFixed(2);
  const ra = (med.rangeAvg * 100).toFixed(2);
  const vr = med.volRatio.toFixed(2);
  const rsi = med.rsiEnd.toFixed(1);
  return (
    `Son **${lookbackDays} gün** içinde toplam getirisi en yüksek olan rallilerden **${sampleWinners}** pariteyi örnek aldık (liste olarak göstermiyoruz). ` +
    `Her birinde, **tek gün en güçlü yükselişten hemen önceki 5 işlem günü** ortak bir “ön hazırlık” profili oluşturuyor.\n\n` +
    `Bu profilin tipik özeti:\n` +
    `• 5 günde günlük ortalama getiri ≈ **%${mr}**\n` +
    `• Aynı 5 günde kümülatif fiyat hareketi ≈ **%${cr}**\n` +
    `• Günlük mum aralığı (high−low) / fiyat ortalaması ≈ **%${ra}** (volatilite)\n` +
    `• Son gün hacmi, önceki ~20 güne göre medyanın ≈ **${vr}×** katı\n` +
    `• 5. gün sonu RSI ≈ **${rsi}**\n\n` +
    `Aşağıdaki liste, **şu anki son 5 günü** bu profile sayısal olarak yakın olan paritelerdir. Yatırım tavsiyesi değildir.`
  ).replace(/\*\*/g, '');
}

function buildMatchNotesTr(vec, med) {
  if (!vec || !med) return ['Profil karşılaştırması özet benzerlik skorunda.'];
  const notes = [];
  const vC = vec.cumRet;
  const mC = med.cumRet;
  if (Number.isFinite(vC) && Number.isFinite(mC) && Math.abs(vC - mC) < Math.max(0.02, Math.abs(mC) * 0.45 + 0.01)) {
    notes.push('Son 5 günün birikimli hareketi, tarihsel büyük ralli öncesi tipik banda yakın.');
  }
  if (vec.volRatio >= med.volRatio * 0.82) {
    notes.push('Hacim (son güne göre 20g medyanı), kazanan öncesi profilde görülen ilgi artışına benziyor.');
  }
  if (vec.rsiEnd >= med.rsiEnd - 15 && vec.rsiEnd <= med.rsiEnd + 22) {
    notes.push('RSI seviyesi, o dönem örneklerindeki “rally öncesi” RSI bandına yakın.');
  }
  if (vec.rangeAvg >= med.rangeAvg * 0.88) {
    notes.push('Günlük mum genişliği (oynaklık), tarihsel örneklerle uyumlu veya daha hareketli.');
  }
  if (vec.meanRet >= med.meanRet - 0.002) {
    notes.push('Günlük ortalama getiri, sıkışma sonrası hamle öncesi ortalamaya yakın.');
  }
  if (!notes.length) {
    notes.push('Birden fazla gösterge birlikte medyan kazanan profiline yakın (benzerlik yüzdesi ile özetlenir).');
  }
  return notes;
}

/**
 * LOOKBACK_DAYS günlük seri: içeride en iyi ralli öncesi 5g profilinin medyanı;
 * güncel son 5g ile benzerlik — top kazanan listesi API’de dönülmez (sadece model).
 */
async function computeWinnerPatternAnalysis(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cache.payload && now - cache.at < CACHE_MS) {
    return { ...cache.payload, cached: true };
  }

  const started = Date.now();
  const coins = await binance.getTRYCoins();
  const winLen = 5;
  const limit = Math.min(1500, LOOKBACK_DAYS + 40);

  const bySymbol = new Map();

  for (const c of coins) {
    try {
      const candles = await binance.getOHLCV(c.pair, '1d', limit);
      if (!candles || candles.length < 40) {
        await binance.bekle(BETWEEN_MS);
        continue;
      }
      const longReturnPct = returnOverFullSeries(candles);
      if (longReturnPct == null || !Number.isFinite(longReturnPct)) {
        await binance.bekle(BETWEEN_MS);
        continue;
      }
      const { bestI, bestR } = findBestUpDayIndex(candles);
      let preProfile = null;
      if (bestI >= winLen + 1) {
        preProfile = windowMetrics(candles, bestI - 1, winLen);
      }
      const endNow = candles.length - 1;
      const currentProfile = endNow >= winLen ? windowMetrics(candles, endNow, winLen) : null;

      bySymbol.set(c.pair, {
        candles,
        longReturnPct,
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
    .filter((d) => Number.isFinite(d.longReturnPct))
    .sort((a, b) => b.longReturnPct - a.longReturnPct);

  const topN = 25;
  const winnerProfiles = ranked
    .slice(0, topN)
    .map((d) => d.preProfile)
    .filter(Boolean);

  let archetype = null;
  let peers = [];
  let medRef = null;
  let sigRef = null;

  if (winnerProfiles.length >= 5) {
    const { med, sig } = statsFromProfiles(winnerProfiles);
    medRef = med;
    sigRef = sig;
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
        const hits = countStructuralHits(d.currentProfile, med);
        return {
          symbol: d.symbol,
          similarity: sim,
          structuralHits: hits,
          longReturnPct: Math.round(d.longReturnPct * 100) / 100,
          features: {
            meanRet5d: Math.round(d.currentProfile.meanRet * 10000) / 10000,
            cumRet5d: Math.round(d.currentProfile.cumRet * 10000) / 10000,
            rangeAvg: Math.round(d.currentProfile.rangeAvg * 10000) / 10000,
            volRatio: Math.round(d.currentProfile.volRatio * 100) / 100,
            rsi: Math.round(d.currentProfile.rsiEnd * 10) / 10
          },
          matchNotesTr: buildMatchNotesTr(d.currentProfile, med)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity);
  }

  const topGainerSet = new Set(ranked.slice(0, topN).map((d) => d.symbol));
  const similarNow = peers
    .filter((p) => !topGainerSet.has(p.symbol))
    .filter((p) => p.similarity >= MIN_SIMILARITY)
    .filter((p) => p.structuralHits >= MIN_STRUCTURAL_HITS || p.similarity >= HIGH_SIM_ESCAPE)
    .filter((p) => {
      const row = bySymbol.get(p.symbol);
      return hasMeaningfulRecentStructure(row?.currentProfile, medRef);
    })
    .slice(0, MAX_SIMILAR_LISTED);

  const patternNarrativeTr = buildPatternNarrativeTr(LOOKBACK_DAYS, archetype?.sampleWinners || 0, medRef);

  const filterSummaryTr =
    `Liste daraltma: benzerlik ≥%${MIN_SIMILARITY}, en az ${MIN_STRUCTURAL_HITS} yapı taşı (hacim/RSI/aralık vb.) veya benzerlik ≥%${HIGH_SIM_ESCAPE}; ` +
    'son 5 günü tamamen yatay/hacimsiz eşleşmeler elenir. En fazla ' +
    `${MAX_SIMILAR_LISTED} parite. Railway’de WINNER_PATTERN_* ile ince ayar yapılabilir.`;

  const payload = {
    ok: true,
    cached: false,
    updatedAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    symbolCount: bySymbol.size,
    durationMs: Date.now() - started,
    patternNarrativeTr,
    methodNoteTr:
      `Arka planda son ${LOOKBACK_DAYS} günlük toplam getiriye göre üst dilim seçilir; “kazanan ralli öncesi 5 gün” medyanı çıkarılır. ` +
      'Yüksek getiren paritelerin isim listesi istemciye gönderilmez; yalnızca şu an bu profile benzeyenler listelenir.',
    listFilters: {
      minSimilarity: MIN_SIMILARITY,
      minStructuralHits: MIN_STRUCTURAL_HITS,
      highSimilarityEscape: HIGH_SIM_ESCAPE,
      maxMatches: MAX_SIMILAR_LISTED,
      distScale: SIM_DIST_SCALE
    },
    filterSummaryTr,
    archetype,
    similarNow,
    note: 'Yatırım tavsiyesi değildir. Geçmiş performans geleceği göstermez.'
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
