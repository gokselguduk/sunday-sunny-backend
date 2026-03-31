/**
 * Liste / tahta snapshot'ından tek parite: durum kodu, tazelik, çelişkiler,
 * motor hizası, piyasa arka planı ve tüm önemli analiz katmanlarının birleşik özeti.
 */

const UNIFIED_SCHEMA_VERSION = '2.3.0';

const { CONFIG } = require('./scanner/config');

const LIFECYCLE = {
  NO_DETAIL: 'NO_DETAIL',
  LIST_ONLY: 'LIST_ONLY',
  BOARD_FRESH: 'BOARD_FRESH',
  BOARD_STALE: 'BOARD_STALE'
};

function pickDetail(snap) {
  if (!snap || typeof snap !== 'object') return null;
  if (snap.listDetail && typeof snap.listDetail === 'object') return snap.listDetail;
  return null;
}

function parseScannedAt(s, snap, boardSignal) {
  const raw = boardSignal?.scannedAt || s?.scannedAt || snap?.scannedAt || null;
  if (!raw) return { iso: null, ageMinutes: null };
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return { iso: raw, ageMinutes: null };
  const ageMinutes = Math.round((Date.now() - t) / 60000);
  return { iso: raw, ageMinutes };
}

function staleThresholdMinutes() {
  const n = parseInt(process.env.UNIFIED_STALE_AFTER_MIN, 10);
  if (Number.isFinite(n) && n >= 5) return Math.min(n, 240);
  return Math.max(50, Math.round(CONFIG.SCAN_INTERVAL_MS / 60000) + 8);
}

function slimMarketContext(ctx) {
  if (!ctx || ctx.ok === false) {
    return ctx?.error ? { ok: false, error: ctx.error } : null;
  }
  return {
    ok: true,
    updatedAt: ctx.updatedAt,
    cacheAgeMs: ctx.cacheAgeMs,
    cached: ctx.cached,
    btc24hPct: ctx.perp24h?.priceChangePercent ?? null,
    fundingApproxPct: ctx.funding?.approxPctPerPeriod ?? null,
    oiChange1hPct: ctx.openInterest?.change1hPct ?? null,
    takerHint: ctx.takerFlow?.hint ?? null,
    macro: ctx.macro?.narrative
      ? {
          btc24hPct: ctx.macro.narrative.btc24hPct,
          dxy1dPct: ctx.macro.narrative.dxy1dPct,
          typicalRiskOn: ctx.macro.narrative.typicalRiskOn,
          note: ctx.macro.narrative.note
        }
      : null
  };
}

function slimBtc(btc) {
  if (!btc || btc.ok === false) {
    return {
      ok: false,
      message: btc?.message || 'BTC nabzı henüz yok',
      updatedAt: btc?.updatedAt || null
    };
  }
  return {
    ok: true,
    updatedAt: btc.updatedAt,
    overallSignal: btc.overallSignal ?? null,
    regime: btc.regime?.type ?? null,
    priceChange24h: btc.priceChange24h ?? null,
    firsatSkoru: btc.firsatSkoru?.skor ?? null
  };
}

function buildConflictsAndBias(s, scenarioBias, fs, mtf, anomaly, ai, div, fvg) {
  const conflicts = [];

  const manip = Number(ai?.manipulationRisk);
  if (scenarioBias === 'bullish' && Number.isFinite(manip) && manip >= 7) {
    conflicts.push({
      code: 'AI_RISK_VS_BULLISH_BIAS',
      severity: 'high',
      message: `AI manipülasyon riski yüksek (${manip}/10) iken senaryo eğilimi yapıcı görünüyor; dikkatli olun.`
    });
  }

  if (scenarioBias === 'bullish' && anomaly?.isAnomaly) {
    conflicts.push({
      code: 'ANOMALY_VS_BULLISH_BIAS',
      severity: 'medium',
      message: 'Hacim/hareket anomalisi işaretli iken yapıcı senaryo zayıflar; sahte kırılım riski.'
    });
  }

  if (scenarioBias === 'bullish' && Number.isFinite(fs) && fs < 45 && mtf?.allAligned) {
    conflicts.push({
      code: 'LOW_FIRSAT_VS_STRUCTURE',
      severity: 'medium',
      message: `MTF uyumlu görünse de fırsat skoru düşük (${fs}); motor eşikleri agresif beklentiyi desteklemiyor.`
    });
  }

  if (scenarioBias === 'cautious' && Number.isFinite(fs) && fs >= 70) {
    conflicts.push({
      code: 'HIGH_FIRSAT_VS_CAUTION',
      severity: 'low',
      message: `Fırsat skoru yüksek (${fs}) fakat risk katmanları temkinli moda çekiyor; fırsat ile risk birlikte okunmalı.`
    });
  }

  if (div?.bearish || div?.hidden_bearish) {
    conflicts.push({
      code: 'BEARISH_DIVERGENCE',
      severity: 'medium',
      message: div.bearish
        ? 'Ayı uyumsuzluğu (bearish divergence) yapıcı senaryoya ters düşebilir.'
        : 'Gizli ayı uyumsuzluğu trend sağlığını zayıflatır.'
    });
  }

  if (scenarioBias === 'bullish' && fvg && !fvg.inBullishFVG && !fvg.hasBullishFVG) {
    /* opsiyonel bilgi — çelişki saymayalım, sadece not */
  }

  return conflicts;
}

function motorAlignment(scenarioBias, fs, netScore, conflicts) {
  let aligned = true;
  const notes = [];

  if (scenarioBias === 'bullish' && Number.isFinite(fs) && fs < 50) {
    aligned = false;
    notes.push('Senaryo yapıcı; fırsat skoru ortanın altında — eşik / ceza katmanları baskın.');
  }
  if (scenarioBias === 'cautious' && Number.isFinite(fs) && fs >= 65) {
    aligned = false;
    notes.push('Fırsat yüksek görünüyor; anomali veya AI riski senaryoyu temkinliye çekiyor.');
  }
  if (conflicts.some((c) => c.severity === 'high')) {
    aligned = false;
    notes.push('Yüksek önemde çelişki bayrakları var.');
  }

  const net = Number.isFinite(netScore) ? netScore : null;
  if (net != null && Number.isFinite(fs)) {
    if (net >= 8 && fs < 40) {
      aligned = false;
      notes.push('Net skor ile fırsat skoru birbirinden uzak; farklı ağırlıklar devrede.');
    }
  }

  return {
    aligned,
    scenarioBias,
    firsatSkor: Number.isFinite(fs) ? fs : null,
    netScore: net,
    explanation: notes.length ? notes.join(' ') : 'Senaryo özeti ile motor skorları genel olarak uyumlu.'
  };
}

function marketBackdropSentence(marketBrief, btcBrief, symbolBase) {
  const parts = [];
  if (btcBrief?.ok && btcBrief.priceChange24h != null) {
    parts.push(`BTC 24s %${Number(btcBrief.priceChange24h).toFixed(2)} (${btcBrief.overallSignal || '—'})`);
  } else if (btcBrief && !btcBrief.ok) {
    parts.push('BTC nabzı kısa');
  }
  if (marketBrief?.ok && marketBrief.btc24hPct != null) {
    parts.push(`Bağlam BTC %${Number(marketBrief.btc24hPct).toFixed(2)}`);
  }
  if (marketBrief?.macro?.typicalRiskOn === true) {
    parts.push('Makro okuma: risk-on eğilimi (kaba)');
  } else if (marketBrief?.macro?.typicalRiskOn === false && marketBrief.macro?.btc24hPct != null) {
    parts.push('Makro okuma: karışık / risk-off eğilimi olabilir');
  }
  if (!parts.length) return `Genel piyasa özeti kısıtlı; ${symbolBase} teknik katmanları öne çıkar.`;
  return `${symbolBase} bağlamında piyasa: ${parts.join(' · ')}.`;
}

/**
 * @param {object} snap — listRegistry kaydı
 * @param {object} [opts]
 * @param {object|null} [opts.boardSignal] — signalRegistry satırı (tahtada ise)
 * @param {object|null} [opts.marketBrief] — slimMarketContext çıktısı
 * @param {object|null} [opts.btcBrief] — slimBtc çıktısı
 */
function buildUnifiedFromSnapshot(snap, opts = {}) {
  const boardSignal = opts.boardSignal ?? null;
  const marketBrief = opts.marketBrief ?? null;
  const btcBrief = opts.btcBrief ?? null;

  const symbol = snap?.symbol || pickDetail(snap)?.symbol || boardSignal?.symbol || null;
  const listReason = snap?.listReason || null;
  const onBoard = Boolean(boardSignal);
  const absentThisScan = Boolean(boardSignal?.absentThisScan);

  if (!symbol) {
    return { ok: false, schemaVersion: UNIFIED_SCHEMA_VERSION, error: 'Sembol yok' };
  }

  const s = pickDetail(snap);
  const base = symbol.replace(/USDT$/i, '');

  if (!s) {
    return {
      ok: true,
      schemaVersion: UNIFIED_SCHEMA_VERSION,
      symbol,
      base,
      lifecycleStatus: LIFECYCLE.NO_DETAIL,
      hasFullDetail: false,
      listReason,
      onBoard,
      absentThisScan,
      freshness: { scannedAt: snap?.scannedAt || null, ageMinutes: null, isStale: true, staleAfterMinutes: staleThresholdMinutes() },
      conflicts: [],
      motorAlignment: null,
      marketBackdrop: { sentence: marketBackdropSentence(marketBrief, btcBrief, base), marketBrief, btcBrief },
      scenarioBias: 'unknown',
      narrativeLead: '',
      narrative: 'Bu parite için henüz tam analiz gövdesi yok. Tam tarama veya tek coin yenileme kullanın.',
      narrativeDetail: '',
      bullets: [],
      healthFlags: ['NO_ANALYSIS_BODY'],
      sections: {}
    };
  }

  const fs = s.firsatSkoru?.skor;
  const netScore = s.score;
  const mtf = s.mtfDetay || {};
  const ob = s.orderBook || {};
  const div = s.divergence || {};
  const fvg = s.fvg || {};
  const reg = s.regime || {};
  const ai = s.ai || {};
  const run = s.runnerPotential;
  const hz = s.horizon;
  const diag = s.diagnostics;
  const cp = s.candlePatterns;
  const arb = s.arbitraj;
  const sr = s.supportResistance;
  const fib = s.fibonacci;
  const learn = s.learningData;

  const { iso: scannedAt, ageMinutes } = parseScannedAt(s, snap, boardSignal);
  const staleM = staleThresholdMinutes();
  const isStale = ageMinutes == null ? false : ageMinutes > staleM;

  let lifecycleStatus = LIFECYCLE.LIST_ONLY;
  if (onBoard && !absentThisScan) lifecycleStatus = LIFECYCLE.BOARD_FRESH;
  else if (onBoard && absentThisScan) lifecycleStatus = LIFECYCLE.BOARD_STALE;

  const healthFlags = [];
  if (isStale) healthFlags.push('STALE_DATA');
  if (absentThisScan) healthFlags.push('ABSENT_LAST_FULL_SCAN');
  if (listReason && listReason !== 'FIRSAT_ESIK' && !onBoard) healthFlags.push('LIST_REASON_' + listReason);

  let pos = 0;
  let neg = 0;
  if (mtf.allAligned) pos += 2;
  else neg += 1;
  if (Number.isFinite(fs)) {
    if (fs >= 70) pos += 2;
    else if (fs >= 55) pos += 1;
    else neg += 1;
  }
  if (div.bullish || div.hidden_bullish) pos += 1;
  if (div.bearish || div.hidden_bearish) neg += 2;
  if (fvg.inBullishFVG || fvg.hasBullishFVG) pos += 1;
  if (s.anomaly?.isAnomaly) neg += 2;
  if (Number.isFinite(ai.manipulationRisk) && ai.manipulationRisk >= 7) neg += 2;
  if (String(ai.verdict || '').toLowerCase().includes('dikkat')) neg += 1;

  let scenarioBias = 'neutral';
  if (pos >= 5 && neg <= 2) scenarioBias = 'bullish';
  else if (neg >= 4) scenarioBias = 'cautious';

  const conflicts = buildConflictsAndBias(s, scenarioBias, fs, mtf, s.anomaly, ai, div, fvg);
  if (conflicts.length) healthFlags.push('CONFLICTS_PRESENT');

  const motor = motorAlignment(scenarioBias, fs, netScore, conflicts);

  const bullets = [];

  bullets.push(
    onBoard
      ? absentThisScan
        ? 'Tahta: kayıtlı ancak son tam taramada eşik altı kaldı (veri bayat sayılabilir).'
        : 'Tahta: aktif sinyal satırı; son turda tahtada kaldı.'
      : 'Tahta dışı: yalnızca liste özeti (eşik altı veya önceki tur).'
  );

  if (scannedAt != null) {
    bullets.push(
      `Son analiz zamanı: ${new Date(scannedAt).toLocaleString('tr-TR')}` +
        (ageMinutes != null ? ` (~${ageMinutes} dk önce${isStale ? ', tazelik sınırını aştı' : ''})` : '')
    );
  }

  if (mtf.allAligned) {
    bullets.push(
      mtf.hasWeekly
        ? 'MTF: 15m–1h–4h–1d–1w yönü uyumlu.'
        : 'MTF: 15m–1h–4h–1d yönü uyumlu (haftalık veri yok).'
    );
  } else {
    const w = mtf.hasWeekly ? ` / ${mtf.dir1w || '—'} (1w)` : '';
    bullets.push(
      `MTF: ${mtf.dir15m || '—'} / ${mtf.dir1h || '—'} / ${mtf.dir4h || '—'} / ${mtf.dir1d || '—'}${w} — tam hizalı değil.`
    );
  }

  if (Number.isFinite(fs)) {
    bullets.push(`Fırsat skoru ${fs} (${s.firsatSkoru?.seviye || '—'}).`);
  }
  if (Number.isFinite(netScore)) {
    bullets.push(`Net motor skoru ${netScore} (1h ve MTF katkıları dahil).`);
  }

  if (run != null && typeof run === 'object' && Number.isFinite(run.score)) {
    bullets.push(`Runner potansiyeli ${run.score}/100.`);
  }

  if (s.kriptoAnaliz?.sezon?.etiket) {
    const ka = s.kriptoAnaliz;
    bullets.push(
      `Kripto analiz sistemi (PPT): sezon “${ka.sezon.etiket}”, MTF “${ka.mtfUyumu?.kararKodu || '—'}”, hacim–fiyat “${ka.hacimFiyat?.profil || '—'}”.`
    );
  }

  if (div.bullish || div.hidden_bullish) {
    bullets.push(div.bullish ? 'Bullish divergence işaretlendi.' : 'Gizli bullish divergence.');
  }
  if (div.bearish || div.hidden_bearish) {
    bullets.push(div.bearish ? 'Bearish divergence işaretlendi.' : 'Gizli bearish divergence.');
  }

  if (fvg.inBullishFVG) {
    bullets.push('Fiyat boğa FVG içinde veya çok yakınında.');
  } else if (fvg.hasBullishFVG && Number.isFinite(fvg.bullishDist)) {
    bullets.push(`Boğa FVG yaklaşık %${fvg.bullishDist.toFixed(2)} uzakta.`);
  }

  if (reg.type) {
    bullets.push(`Rejim: ${reg.type} (skor ${reg.regimeScore ?? '—'}).`);
  }

  if (ob.summary || ob.bias) {
    bullets.push(`Emir defteri: ${ob.bias || ob.summary || '—'}.`);
  }

  if (s.anomaly?.isAnomaly) {
    bullets.push(`Anomali: Z≈${s.anomaly.zScore ?? '—'} — ${s.anomaly.reason || s.anomaly.signal || ''}.`);
  }

  if (ai.verdict) {
    bullets.push(`AI: ${ai.verdict}${Number.isFinite(ai.manipulationRisk) ? ` · manipülasyon ${ai.manipulationRisk}/10` : ''}.`);
  }

  if (hz?.label || hz?.summary) {
    bullets.push(`Hedef süre: ${hz.label || hz.summary || '—'}.`);
  }

  if (diag) {
    bullets.push(
      `Teşhis: volatilite ${diag.volatility?.level || '—'}, likidite ${diag.liquidity?.score ?? '—'}/100, trend sağlığı ${diag.trendHealth?.score ?? '—'}/100.`
    );
  }

  if (cp?.patterns?.length) {
    const names = cp.patterns
      .slice(0, 3)
      .map((p) => p.name)
      .filter(Boolean);
    if (names.length) {
      bullets.push(`Mum formasyonları: ${names.join(', ')}${cp.hasBullish ? ' (yükseliş eğilimli)' : ''}.`);
    }
  }

  if (arb?.signal) {
    bullets.push(`Arbitraj (TRY çerçeve): ${arb.signal}${arb.spreadPct != null ? ` · spread %${arb.spreadPct.toFixed(4)}` : ''}.`);
  }

  if (sr?.nearestSupport || sr?.nearestResistance) {
    const bits = [];
    if (sr.nearestSupport) bits.push(`destek ${Number(sr.nearestSupport).toFixed(6)} (${sr.supportDistance != null ? sr.supportDistance.toFixed(2) + '%' : '—'})`);
    if (sr.nearestResistance) bits.push(`direnç ${Number(sr.nearestResistance).toFixed(6)} (${sr.resistanceDistance != null ? sr.resistanceDistance.toFixed(2) + '%' : '—'})`);
    if (bits.length) bullets.push('SR: ' + bits.join(' · ') + '.');
  }

  if (fib && (fib.atSupport || fib.atResistance || fib.nearestSupport || fib.nearestResistance)) {
    bullets.push(
      `Fib: ${fib.atSupport ? 'destek bölgesi' : fib.atResistance ? 'direnç bölgesi' : 'seviye yakını'} — ${fib.nearestSupport || fib.nearestResistance || ''}.`
    );
  }

  if (learn && learn.total > 0) {
    const rate = learn.successRate != null ? `%${learn.successRate}` : '—';
    bullets.push(`Redis geçmişi: ${learn.total} sonuçlanmış kayıt (TP/SL), başarı oranı ${rate}.`);
  }

  conflicts.forEach((c) => {
    bullets.push(`⚠ ${c.message}`);
  });

  let narrativeLead = '';
  if (scenarioBias === 'bullish') {
    narrativeLead = 'Özet: yapı ve MTF ağırlıklı olarak yükseliş lehine birleşiyor.';
  } else if (scenarioBias === 'cautious') {
    narrativeLead = 'Özet: risk ve anomali katmanları baskın; agresif beklenti zayıf.';
  } else {
    narrativeLead = 'Özet: karışık sinyaller; yapı ile riski birlikte okuyun.';
  }

  if (motor && !motor.aligned) {
    narrativeLead += ' Motor skorları ile özet eğilim tam örtüşmüyor — aşağıdaki hizayı okuyun.';
  }

  const narrativeDetail = bullets.join(' ');
  const narrative = [narrativeLead, narrativeDetail].filter(Boolean).join(' ');

  const backdrop = {
    sentence: marketBackdropSentence(marketBrief, btcBrief, base),
    marketBrief,
    btcBrief
  };

  return {
    ok: true,
    schemaVersion: UNIFIED_SCHEMA_VERSION,
    symbol: s.symbol || symbol,
    base,
    lifecycleStatus,
    hasFullDetail: true,
    listReason,
    onBoard,
    absentThisScan,
    signalQualification: onBoard ? 'ON_BOARD' : listReason || 'LIST_SUMMARY',
    freshness: {
      scannedAt,
      ageMinutes,
      isStale,
      staleAfterMinutes: staleM,
      scanIntervalMinutes: Math.round(CONFIG.SCAN_INTERVAL_MS / 60000)
    },
    conflicts,
    motorAlignment: motor,
    marketBackdrop: backdrop,
    scenarioBias,
    narrativeLead,
    narrativeDetail,
    narrative,
    bullets,
    healthFlags,
    sections: {
      mtf: {
        allAligned: !!mtf.allAligned,
        hasWeekly: !!mtf.hasWeekly,
        dir15m: mtf.dir15m,
        dir1h: mtf.dir1h,
        dir4h: mtf.dir4h,
        dir1d: mtf.dir1d,
        dir1w: mtf.dir1w,
        score1w: s.score1w != null ? s.score1w : null,
        momentumBoost: mtf.momentumBoost
      },
      firsat: s.firsatSkoru || null,
      runner: run || null,
      regime: reg,
      orderBook: { bias: ob.bias, summary: ob.summary, imbalance: ob.imbalance },
      footprint: s.footprint
        ? { deltaTrend: s.footprint.deltaTrend, strongBull: s.footprint.strongBull, strongBear: s.footprint.strongBear }
        : null,
      anomaly: s.anomaly || null,
      divergence: {
        bullish: !!div.bullish,
        hidden_bullish: !!div.hidden_bullish,
        bearish: !!div.bearish,
        hidden_bearish: !!div.hidden_bearish
      },
      fvg: {
        inBullishFVG: !!fvg.inBullishFVG,
        hasBullishFVG: !!fvg.hasBullishFVG,
        bullishDist: fvg.bullishDist
      },
      diagnostics: diag || null,
      candlePatterns: cp
        ? { hasBullish: !!cp.hasBullish, patterns: cp.patterns?.slice(0, 5) || [] }
        : null,
      arbitraj: arb || null,
      supportResistance: sr || null,
      fibonacci: fib || null,
      learning: learn && learn.total > 0
        ? { total: learn.total, successRate: learn.successRate, success: learn.success, fail: learn.fail }
        : null,
      atr: s.atr
        ? {
            tp1Pct: s.atr.tp1Pct,
            tp2Pct: s.atr.tp2Pct,
            tp3Pct: s.atr.tp3Pct,
            riskReward: s.atr.riskReward
          }
        : null,
      horizon: hz || null,
      ai: ai.verdict
        ? { verdict: ai.verdict, manipulationRisk: ai.manipulationRisk, summary: ai.summary }
        : null,
      kriptoAnaliz: s.kriptoAnaliz
        ? {
            sezon: s.kriptoAnaliz.sezon,
            mtfUyumu: {
              kararKodu: s.kriptoAnaliz.mtfUyumu?.kararKodu,
              kararMetni: s.kriptoAnaliz.mtfUyumu?.kararMetni,
              guven: s.kriptoAnaliz.mtfUyumu?.guven
            },
            hacimFiyat: {
              profil: s.kriptoAnaliz.hacimFiyat?.profil,
              aciklama: s.kriptoAnaliz.hacimFiyat?.aciklama
            },
            makroKatman: s.kriptoAnaliz.makroKatman
              ? {
                  entegre: !!s.kriptoAnaliz.makroKatman.entegre,
                  uyumlulukLong: s.kriptoAnaliz.makroKatman.uyumlulukLong ?? null,
                  ozet: s.kriptoAnaliz.makroKatman.ozet ?? null
                }
              : null,
            onChainKatman: s.kriptoAnaliz.onChainKatman
              ? (() => {
                  const o = s.kriptoAnaliz.onChainKatman;
                  let oz = o.ozet;
                  if (oz == null && o.entegre) {
                    const m = o.metrikler;
                    const z = Array.isArray(m) ? m.find((x) => x.kod === 'MVRV_Z') : null;
                    oz =
                      z && Number.isFinite(z.deger)
                        ? `MVRV Z ≈ ${z.deger}`
                        : 'BTC on-chain (Glassnode) bağlı';
                  } else if (oz == null && !o.entegre) {
                    oz = o.reason || o.pariteNot || null;
                  }
                  return { entegre: !!o.entegre, ozet: oz };
                })()
              : null,
            riskOzet: s.kriptoAnaliz.riskOzet,
            checklistOzet: s.kriptoAnaliz.checklist20?.ozet,
            checklistMaddeler: Array.isArray(s.kriptoAnaliz.checklist20?.maddeler)
              ? s.kriptoAnaliz.checklist20.maddeler.map((m) => ({
                  no: m.no,
                  katman: m.katman,
                  soru: m.soru,
                  durum: m.durum,
                  kaynak: m.kaynak
                }))
              : [],
            makroEntegre: !!s.kriptoAnaliz.makroKatman?.entegre,
            onChainEntegre: !!s.kriptoAnaliz.onChainKatman?.entegre,
            pptAsamaSayisi: Array.isArray(s.kriptoAnaliz.pptAsamalari) ? s.kriptoAnaliz.pptAsamalari.length : 0,
            pptAsamalari: Array.isArray(s.kriptoAnaliz.pptAsamalari)
              ? s.kriptoAnaliz.pptAsamalari.map((a) => ({
                  slayt: a.slayt,
                  kod: a.kod,
                  baslik: a.baslik,
                  durum: a.durum,
                  ozet: a.ozet
                }))
              : [],
            firsatKaynak: s.firsatSkoru?.kaynak || null
          }
        : null
    }
  };
}

module.exports = {
  UNIFIED_SCHEMA_VERSION,
  buildUnifiedFromSnapshot,
  pickDetail,
  slimMarketContext,
  slimBtc
};
