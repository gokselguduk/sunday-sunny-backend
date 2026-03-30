#!/usr/bin/env node
/**
 * Binance USDT-M günlük mumlar: son LOOKBACK gün içinde günlük kapanış getirisi
 * >= MIN_RET % olan "patlama" günlerini tarar; patlamadan bir önceki günün
 * RSI(14), hacim oranı, günlük aralık %, önceki 3g getiri, üst üste yeşil gün
 * istatistiklerini toplar.
 *
 * BINANCE_TR_COINS tanımlıysa önce TR listesi + futures kesişimi kullanılır;
 * değilse 24s USDT hacmine göre üst semboller (Türk piyasasına yakın evren).
 *
 * Çalıştır: node scripts/analyzeBurstLeadup.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const axios = require('axios');
const binance = require('../src/services/binance');

const FAPI = 'https://fapi.binance.com/fapi/v1';
const KL_LIMIT = 40;
const WINDOW_LAST = 10;
const MIN_DAILY_RET = 30;
const DELAY_MS = 40;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function median(arr) {
  const a = arr.filter((x) => x != null && Number.isFinite(x));
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(arr) {
  const a = arr.filter((x) => x != null && Number.isFinite(x));
  if (!a.length) return null;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

/** closes: en az 15 kapanış, son eleman = patlama öncesi gün kapanışı */
function rsi14Wilderish(closes) {
  if (closes.length < 15) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  const ag = gains / 14;
  const al = losses / 14;
  if (al === 0) return ag > 0 ? 100 : 50;
  const rs = ag / al;
  return 100 - 100 / (1 + rs);
}

async function resolveSymbols() {
  const volumeTop = process.argv.includes('--volume-top');
  if (volumeTop) {
    const { data } = await axios.get(`${FAPI}/ticker/24hr`, { timeout: 22000 });
    return [
      ...new Set(
        data
          .filter((t) => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
          .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
          .slice(0, 200)
          .map((t) => t.symbol)
      )
    ];
  }
  let pairs = [];
  try {
    const coins = await binance.getTRYCoins();
    pairs = coins.map((c) => c.pair);
  } catch (_) {
    pairs = [];
  }
  if (pairs.length < 15) {
    const { data } = await axios.get(`${FAPI}/ticker/24hr`, { timeout: 22000 });
    pairs = data
      .filter((t) => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 160)
      .map((t) => t.symbol);
  }
  return [...new Set(pairs)];
}

async function fetchDaily(symbol) {
  const { data } = await axios.get(`${FAPI}/klines`, {
    params: { symbol, interval: '1d', limit: KL_LIMIT },
    timeout: 15000
  });
  return data.map((k) => ({
    t: k[0],
    o: parseFloat(k[1]),
    h: parseFloat(k[2]),
    l: parseFloat(k[3]),
    c: parseFloat(k[4]),
    qv: parseFloat(k[7])
  }));
}

async function main() {
  const symbols = await resolveSymbols();
  console.error(`Sembol sayısı: ${symbols.length} (son ${WINDOW_LAST} günlük mumda >=%${MIN_DAILY_RET} aranıyor)\n`);

  const events = [];

  for (const sym of symbols) {
    try {
      const d = await fetchDaily(sym);
      await sleep(DELAY_MS);
      const n = d.length;
      if (n < WINDOW_LAST + 8) continue;

      for (let i = n - WINDOW_LAST; i < n; i++) {
        if (i < 1) continue;
        const prevC = d[i - 1].c;
        if (!prevC) continue;
        const burstRet = ((d[i].c - prevC) / prevC) * 100;
        if (burstRet < MIN_DAILY_RET) continue;

        const before = i - 1;
        const closes = d.slice(0, before + 1).map((x) => x.c);
        const rsiD1 = rsi14Wilderish(closes);

        const volWindow = [];
        for (let k = Math.max(0, i - 8); k <= i - 2 && k < i; k++) {
          if (d[k].qv > 0) volWindow.push(d[k].qv);
        }
        const qvMed = median(volWindow);
        const qvRatio = qvMed > 0 ? d[before].qv / qvMed : null;

        const rangeD1 = d[before].c > 0 ? ((d[before].h - d[before].l) / d[before].c) * 100 : null;

        let streakGreen = 0;
        for (let j = before; j >= 1; j--) {
          if (d[j].c > d[j - 1].c) streakGreen++;
          else break;
        }

        let ret3Before = null;
        if (before >= 3) {
          const c0 = d[before - 3].c;
          if (c0 > 0) ret3Before = ((d[before].c - c0) / c0) * 100;
        }

        events.push({
          symbol: sym,
          burstDate: new Date(d[i].t).toISOString().slice(0, 10),
          burstRetPct: Math.round(burstRet * 100) / 100,
          rsiDayBefore: rsiD1 != null ? Math.round(rsiD1 * 10) / 10 : null,
          volVs7dMedian: qvRatio != null ? Math.round(qvRatio * 100) / 100 : null,
          rangePctDayBefore: rangeD1 != null ? Math.round(rangeD1 * 100) / 100 : null,
          ret3dEndingDayBefore: ret3Before != null ? Math.round(ret3Before * 100) / 100 : null,
          streakGreenBefore: streakGreen
        });
      }
    } catch (e) {
      /* atla */
    }
  }

  const pick = (k) => events.map((e) => e[k]).filter((v) => v != null && Number.isFinite(v));

  const summary = {
    burstEventsInWindow: events.length,
    uniqueSymbols: [...new Set(events.map((e) => e.symbol))].length,
    medianRsiDayBefore: median(pick('rsiDayBefore')),
    medianVolVs7dMedian: median(pick('volVs7dMedian')),
    medianRangePctDayBefore: median(pick('rangePctDayBefore')),
    medianRet3dBefore: median(pick('ret3dEndingDayBefore')),
    medianStreakGreen: median(pick('streakGreenBefore')),
    avgBurstRetPct: avg(events.map((e) => e.burstRetPct))
  };

  console.log(JSON.stringify({ summary, sample: events.slice(0, 25), events }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
