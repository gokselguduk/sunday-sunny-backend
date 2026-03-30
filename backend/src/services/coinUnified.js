/**
 * Liste / tahta snapshot'ından tek parite için birleşik özet ve senaryo metni.
 * @param {object} snap — listRegistry kaydı (listDetail veya minimal alanlar)
 */
function pickDetail(snap) {
  if (!snap || typeof snap !== 'object') return null;
  if (snap.listDetail && typeof snap.listDetail === 'object') return snap.listDetail;
  return null;
}

function buildUnifiedFromSnapshot(snap) {
  const symbol = snap.symbol || pickDetail(snap)?.symbol || null;
  const s = pickDetail(snap);
  const listReason = snap.listReason || null;

  if (!symbol) {
    return { ok: false, error: 'Sembol yok' };
  }

  if (!s) {
    return {
      ok: true,
      symbol,
      hasFullDetail: false,
      listReason,
      narrative: 'Bu parite için henüz tam analiz gövdesi yok. Tam tarama sonrası tekrar deneyin veya tek coin yenileme (POST /api/scan/symbol) kullanın.',
      bullets: [],
      scenarioBias: 'unknown',
      sections: {}
    };
  }

  const fs = s.firsatSkoru?.skor;
  const mtf = s.mtfDetay || {};
  const ob = s.orderBook || {};
  const div = s.divergence || {};
  const fvg = s.fvg || {};
  const reg = s.regime || {};
  const ai = s.ai || {};
  const run = s.runnerPotential;
  const hz = s.horizon;

  const bullets = [];
  if (mtf.allAligned) {
    bullets.push('MTF: 15m–1h–4h–1d yönü uyumlu; trend katmanları çelişmiyor.');
  } else {
    bullets.push(
      `MTF: ${mtf.dir15m || '—'} / ${mtf.dir1h || '—'} / ${mtf.dir4h || '—'} / ${mtf.dir1d || '—'} — tam hizalı değil.`
    );
  }
  if (Number.isFinite(fs)) {
    bullets.push(`Fırsat skoru ${fs} (${s.firsatSkoru?.seviye || '—'}).`);
  }
  if (run != null && typeof run === 'object' && Number.isFinite(run.score)) {
    bullets.push(`Runner potansiyeli ${run.score}/100 — sıçrama öncesi örüntü bileşenleri motor tarafından birleştirildi.`);
  }
  if (div.bullish || div.hidden_bullish) {
    bullets.push(div.bullish ? 'RSI tarafında yükseliş uyumsuzluğu (bullish divergence) işaretlendi.' : 'Gizli yükseliş uyumsuzluğu var.');
  }
  if (fvg.inBullishFVG) {
    bullets.push('Fiyat boğa FVG bölgesinde veya hemen yakınında.');
  } else if (fvg.hasBullishFVG && Number.isFinite(fvg.bullishDist)) {
    bullets.push(`Boğa FVG yaklaşık %${fvg.bullishDist.toFixed(2)} uzaklıkta.`);
  }
  if (reg.type) {
    bullets.push(`Rejim: ${reg.type} (rejim skoru ${reg.regimeScore ?? '—'}).`);
  }
  if (ob.summary || ob.bias) {
    bullets.push(`Emir defteri: ${ob.bias || ob.summary || '—'}.`);
  }
  if (s.anomaly?.isAnomaly) {
    bullets.push(`Dikkat: hacim/hareket anomalisi (Z≈${s.anomaly.zScore ?? '—'}).`);
  }
  if (ai.verdict) {
    bullets.push(`AI görüşü: ${ai.verdict}${Number.isFinite(ai.manipulationRisk) ? ` · manipülasyon riski ${ai.manipulationRisk}/10` : ''}.`);
  }
  if (hz?.label || hz?.summary) {
    bullets.push(`Hedef süre öngörüsü: ${hz.label || hz.summary || '—'}.`);
  }

  let scenarioBias = 'neutral';
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
  if (fvg.inBullishFVG || fvg.hasBullishFVG) pos += 1;
  if (s.anomaly?.isAnomaly) neg += 2;
  if (Number.isFinite(ai.manipulationRisk) && ai.manipulationRisk >= 7) neg += 2;
  if (String(ai.verdict || '').toLowerCase().includes('dikkat')) neg += 1;
  if (pos >= 5 && neg <= 2) scenarioBias = 'bullish';
  else if (neg >= 4) scenarioBias = 'cautious';

  const narrativeParts = [];
  if (scenarioBias === 'bullish') {
    narrativeParts.push('Özet senaryo: göstergeler ve MTF hizası ağırlıklı olarak yükseliş lehine birleşiyor.');
  } else if (scenarioBias === 'cautious') {
    narrativeParts.push('Özet senaryo: anomali veya risk katmanları güçlü; agresif beklenti zayıf, seçici olun.');
  } else {
    narrativeParts.push('Özet senaryo: karışık sinyaller; hem yapı hem risk katmanlarını birlikte okuyun.');
  }
  narrativeParts.push(bullets.slice(0, 4).join(' '));

  return {
    ok: true,
    symbol: s.symbol || symbol,
    hasFullDetail: true,
    listReason,
    scenarioBias,
    narrative: narrativeParts.join(' '),
    bullets,
    sections: {
      mtf: {
        allAligned: !!mtf.allAligned,
        dir15m: mtf.dir15m,
        dir1h: mtf.dir1h,
        dir4h: mtf.dir4h,
        dir1d: mtf.dir1d,
        momentumBoost: mtf.momentumBoost
      },
      firsat: s.firsatSkoru || null,
      runner: run || null,
      regime: reg,
      orderBook: { bias: ob.bias, summary: ob.summary, imbalance: ob.imbalance },
      footprint: s.footprint
        ? { deltaTrend: s.footprint.deltaTrend, strongBull: s.footprint.strongBull }
        : null,
      anomaly: s.anomaly || null,
      divergence: { bullish: !!div.bullish, hidden_bullish: !!div.hidden_bullish },
      fvg: {
        inBullishFVG: !!fvg.inBullishFVG,
        hasBullishFVG: !!fvg.hasBullishFVG,
        bullishDist: fvg.bullishDist
      },
      atr: s.atr
        ? {
            tp1Pct: s.atr.tp1Pct,
            tp2Pct: s.atr.tp2Pct,
            riskReward: s.atr.riskReward
          }
        : null,
      horizon: hz || null,
      ai: ai.verdict
        ? { verdict: ai.verdict, manipulationRisk: ai.manipulationRisk, summary: ai.summary }
        : null
    }
  };
}

module.exports = { buildUnifiedFromSnapshot, pickDetail };
