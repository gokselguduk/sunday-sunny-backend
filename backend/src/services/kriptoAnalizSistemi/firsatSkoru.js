const { SEZON } = require('./constants');

/**
 * Tek başarı kaynağı: PPT tabanlı kriptoAnaliz çıktısından 0–100 fırsat skoru.
 */
function deriveFirsatFromKriptoAnaliz(ka, signal) {
  if (!ka) {
    return { skor: 0, seviye: 'HENÜZ DEĞİL', emoji: '❌', kaynak: 'kripto_analiz_sistemi' };
  }

  let skor = 0;
  const oz = ka.checklist20?.ozet || {};
  const otPuan = Number(oz.otomatikPuanYaklasik) || 0;
  skor += Math.round((otPuan / 20) * 36);

  const g = ka.mtfUyumu?.guven;
  if (g === 'YUKSEK') skor += 24;
  else if (g === 'ORTA') skor += 16;
  else if (g === 'DUSUK') skor += 8;
  else if (g === 'LONG_YOK') skor += 0;

  const p = ka.hacimFiyat?.profil;
  if (p === 'GUC_BULL') skor += 14;
  else if (p === 'UYARI_BULL') skor += 7;
  else if (p === 'GUC_BEAR') skor -= 12;
  else if (p === 'BELIRSIZ_DIP') skor += 4;

  const sez = ka.sezon?.kod;
  if (sez === SEZON.BOGA) skor += 12;
  else if (sez === SEZON.NOTR) skor += 5;
  else if (sez === SEZON.KORKU) skor += 4;
  else if (sez === SEZON.AYI) skor -= 18;

  const rr = ka.riskOzet?.riskReward;
  if (Number.isFinite(rr)) {
    if (rr >= 3) skor += 10;
    else if (rr >= 2) skor += 6;
    else if (rr < 1) skor -= 6;
  }

  if (signal?.footprint?.strongBull) skor += 5;
  else if (signal?.footprint?.bullishDelta) skor += 2;
  if (signal?.footprint?.strongBear) skor -= 4;

  if (signal?.orderBook?.orderFlowScore > 2) skor += 3;
  if (signal?.orderBook?.orderFlowScore < -2) skor -= 3;

  if (signal?.anomaly?.signal === 'MANIPULASYON') skor -= 25;
  else if (signal?.anomaly?.isAnomaly) skor = Math.round(skor * 0.55);

  const mk = ka.makroKatman;
  if (mk?.entegre) {
    if (mk.uyumlulukLong === 'DESTEK') skor += 4;
    if (mk.uyumlulukLong === 'BASKI') skor -= 5;
  }

  const oc = ka.onChainKatman;
  if (oc?.entegre && Array.isArray(oc.metrikler)) {
    const z = oc.metrikler.find((m) => m.kod === 'MVRV_Z')?.deger;
    if (z != null && Number.isFinite(z)) {
      if (z >= 3 && z < 7) skor += 3;
      if (z >= 8) skor -= 6;
      if (z < 0) skor += 2;
    }
  }

  const final = Math.min(Math.max(Math.round(skor), 0), 100);

  let seviye = 'BEKLE';
  let emoji = '⏳';
  if (final >= 80) {
    seviye = 'NADİR FIRSAT';
    emoji = '🔥';
  } else if (final >= 65) {
    seviye = 'GÜÇLÜ FIRSAT';
    emoji = '✅';
  } else if (final >= 50) {
    seviye = 'İYİ FIRSAT';
    emoji = '👍';
  } else if (final >= 35) {
    seviye = 'ORTA';
    emoji = '⏳';
  } else {
    seviye = 'HENÜZ DEĞİL';
    emoji = '❌';
  }

  return { skor: final, seviye, emoji, kaynak: 'kripto_analiz_sistemi' };
}

function runnerFromKripto(ka) {
  if (!ka) return { score: 0, kaynak: 'kripto_analiz_sistemi' };
  const ot = Number(ka.checklist20?.ozet?.otomatikPuanYaklasik) || 0;
  const mtfBonus = ka.mtfUyumu?.guven === 'YUKSEK' ? 28 : ka.mtfUyumu?.guven === 'ORTA' ? 18 : 8;
  const hf = ka.hacimFiyat?.profil === 'GUC_BULL' ? 12 : 0;
  const score = Math.min(100, Math.round(ot * 2.2 + mtfBonus + hf));
  return { score, kaynak: 'kripto_analiz_sistemi' };
}

/** Eski `ai` alanı için uyum: tamamen PPT motorundan türetilmiş özet. */
function aiOzetiFromKripto(ka, signal) {
  if (!ka) {
    return {
      verdict: 'BEKLE',
      manipulationRisk: 0,
      summary: 'Kripto analiz verisi yok.',
      kaynak: 'kripto_analiz_sistemi'
    };
  }
  const mt = ka.mtfUyumu?.kararKodu;
  const sez = ka.sezon?.kod;
  let verdict = 'BEKLE';
  if (mt === 'AL_MAKSIMUM_GUVEN' && (sez === SEZON.BOGA || sez === SEZON.NOTR)) verdict = 'GÜÇLÜ AL';
  else if ((mt === 'AL_BEKLE' || mt === 'KUCUK_POZISYON') && sez !== SEZON.AYI) verdict = 'AL';
  else if (mt === 'LONG_ACMA' || sez === SEZON.AYI) verdict = 'RİSKLİ';
  else if (mt === 'BEKLE_DUZELTME') verdict = 'BEKLE';

  const manip =
    signal?.anomaly?.signal === 'MANIPULASYON'
      ? 9
      : signal?.anomaly?.isAnomaly
        ? 5
        : 0;

  const summary = [
    `Sezon: ${ka.sezon?.etiket || '—'}`,
    ka.mtfUyumu?.kararMetni || '',
    ka.hacimFiyat?.aciklama || ''
  ]
    .filter(Boolean)
    .join(' · ');

  return { verdict, manipulationRisk: manip, summary, kaynak: 'kripto_analiz_sistemi' };
}

module.exports = { deriveFirsatFromKriptoAnaliz, runnerFromKripto, aiOzetiFromKripto };
