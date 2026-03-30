/**
 * "Sürpriz sıçrama" adayı skoru — Binance TR / USDT paritelerinde günlük %30–100+ gibi
 * ani yükselişlerin TAMAMINI öngöremez; öncesi görülen teknik + hacim + rejim örüntülerini tek çatıda toplar.
 */

function computeRunnerPotential(signal) {
  const reasons = [];
  const flags = [];
  let score = 0;

  const pc = Math.abs(Number(signal.priceChange24h) || 0);
  const vol = signal.volume || {};
  const an = signal.anomaly || {};
  const mtf = signal.mtfDetay || {};
  const atr = signal.atr || {};
  const ai = signal.ai || {};
  const ob = signal.orderBook || {};
  const fs = signal.firsatSkoru?.skor || 0;
  const rsi = Number(signal.rsi);
  const regime = signal.regime?.type;

  const ratio = Number(vol.ratio) || 1;
  const vTrend = vol.trend;
  const vZ = Number(an.vZScore) || 0;
  const z = Number(an.zScore) || 0;
  const pct5 = Number(an.pctChg) || 0;

  // Çok geç aşama: zaten devasa günlük — "sürpriz öncesi" değil
  if (pc > 42) {
    score -= 28;
    flags.push('gec_asama');
    reasons.push(
      `24s hareket %${pc.toFixed(0)} civarı — çoğu “sürpriz” koşusu için geç aşama; yeni girişte geri çekilme riski yüksek.`
    );
  } else if (pc > 28) {
    score -= 8;
    flags.push('yuksek_kosum');
    reasons.push(`24s zaten güçlü (%${pc.toFixed(1)}); kalan marj var ama erken sıçrama senaryosu daha az tipik.`);
  }

  // Sıkışma + hacim ısınması (henüz fiyat patlamamış)
  if (pc >= 0 && pc < 10 && vTrend === 'ARTIYOR' && ratio >= 1.35) {
    score += 24;
    flags.push('sikisma_hacim');
    reasons.push(
      'Fiyat henüz sınırlı (%10 altı 24s) iken hacim trendi artıyor — sıkışma sonrası genişleme adaylarında sık görülen örüntü.'
    );
  }

  if (ratio >= 1.85) {
    score += 12;
    flags.push('hacim_sisi');
    reasons.push(`Son mum hacmi 20 mum ortalamasına göre ~${ratio.toFixed(1)}x — ilgi artışı.`);
  } else if (ratio >= 1.45) {
    score += 6;
    flags.push('hacim_ust');
    reasons.push(`Hacim ortalamanın üzerinde (~${ratio.toFixed(1)}x).`);
  }

  // Çoklu zaman uyumu — trend patlamalarında tipik
  if (mtf.allAligned && pc < 35) {
    score += 18;
    flags.push('mtf_hiza');
    reasons.push('15m–1H–4H–1D aynı yönde; güçlü sürdürülebilir hareketlerde sık eşlik eden yapı.');
  } else if (signal.mtfKonfirm && pc < 30) {
    score += 10;
    flags.push('mtf_onay');
    reasons.push('Birden fazla zaman diliminde onay (MTF) mevcut.');
  }

  if (regime === 'BREAKOUT' && pc >= 2 && pc < 32) {
    score += 14;
    flags.push('breakout_rejim');
    reasons.push('Rejim: kırılım — günlükte sert hareket öncesi/erken aşamada görülebilir.');
  }

  const tp3 = Number(atr.tp3Pct) || 0;
  if (tp3 >= 10) {
    score += 14;
    flags.push('genis_tp3');
    reasons.push(`ATR tabanlı üst senaryo geniş (TP3 ~+%${tp3.toFixed(0)} teorik) — büyük hareket alanı.`);
  } else if (tp3 >= 6) {
    score += 7;
    flags.push('tp3_orta');
    reasons.push(`Üçüncü hedefe göre teorik alan ~+%${tp3.toFixed(0)}.`);
  }

  // Son birkaç mumda kıvılcım (ani ivme başlangıcı)
  if (an.signal === 'ANI_HAREKET' && pct5 >= 3 && pct5 < 18) {
    score += 16;
    flags.push('kivlcim');
    reasons.push(`Son mumlarda ani ivme (~%${pct5.toFixed(1)}) — erken kıvılcım sinyali.`);
  }

  if (vZ > 2 && pc < 28) {
    score += 11;
    flags.push('hacim_z');
    reasons.push('Hacim istatistiksel olarak olağanüstü yüksek (hacim Z-skoru).');
  } else if (vZ > 1.5 && pc < 22) {
    score += 6;
    flags.push('hacim_z_hafif');
    reasons.push('Hacim normalin üstünde (dikkat çekici hacim birikimi).');
  }

  if (signal.footprint?.strongBull) {
    score += 9;
    flags.push('delta_boga');
    reasons.push('Emir defteri / delta tarafında güçlü alıcı baskısı özeti.');
  }

  const ofs = Number(ob.orderFlowScore) || 0;
  if (ofs >= 3) {
    score += 7;
    flags.push('orderbook_egilim');
    reasons.push('Derinlikte alım tarafı ağırlığı (order flow skoru).');
  } else if (ob.bullish && ofs >= 1) {
    score += 4;
    flags.push('ob_hafif_boga');
    reasons.push('Order book hafif alıcı eğilimli.');
  }

  if (signal.divergence?.bullish) {
    score += 5;
    flags.push('div_bull');
    reasons.push('Yükselişe eğilimli divergence.');
  }

  if (Number.isFinite(rsi) && rsi >= 55 && rsi < 72 && pc < 25) {
    score += 5;
    flags.push('rsi_henuz_asim');
    reasons.push('RSI güçlü ama aşırı alım bölgesinde değil — bazen “ikinci bacak” için alan.');
  }

  // Fırsat skoru — genel kalite filtresiyle uyum
  score += Math.min(12, Math.round(fs * 0.11));

  if (Number(ai.manipulationRisk) >= 6) {
    score -= 14;
    flags.push('manip_risk');
    reasons.push(`AI manipülasyon riski ${ai.manipulationRisk}/10 — dikkatli olun.`);
  }

  if (an.signal === 'MANIPULASYON' || z > 3.2) {
    score = Math.min(score, 25);
    flags.push('fiyat_asir_uc');
    reasons.push('Fiyat istatistiksel olarak aşırı uçta — spekülatif patlama veya tuzak riski yüksek.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let label = 'DUSUK';
  if (score >= 72) label = 'SICAK_IZLE';
  else if (score >= 52) label = 'ERKEN_ADAY';
  else if (score >= 38) label = 'IZLEME';

  return {
    score,
    label,
    flags,
    reasons: reasons.slice(0, 8)
  };
}

module.exports = { computeRunnerPotential };
