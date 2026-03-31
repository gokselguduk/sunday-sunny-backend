/**
 * PPT Slayt 11 — Risk/ödül özeti (ATR tabanlı).
 */
function buildRiskOzet(signal) {
  const atr = signal.atr || {};
  const rr = atr.riskReward;
  const slPct = atr.stopLossPct;
  const tp1 = atr.tp1Pct;

  let rrDegerlendirme = 'VERI_YOK';
  if (Number.isFinite(rr)) {
    if (rr < 1) rrDegerlendirme = 'ZAYIF_PPT_1_1_ALT';
    else if (rr < 2) rrDegerlendirme = 'MINIMUM_PPT_1_2';
    else if (rr < 3) rrDegerlendirme = 'KABUL_PPT_2_3';
    else if (rr < 5) rrDegerlendirme = 'IYI_PPT_3_5';
    else rrDegerlendirme = 'MUKEMMEL_PPT_5_PLUS';
  }

  return {
    riskReward: Number.isFinite(rr) ? rr : null,
    tp1Pct: Number.isFinite(tp1) ? tp1 : null,
    stopLossPct: Number.isFinite(slPct) ? slPct : null,
    rrDegerlendirme,
    pptNot:
      'PPT: işlem başına max %1–2 risk, korelasyon ve kaldıraç ölçeklemesi — kullanıcı hesabına göre manuel.',
    stopMetodlari: ['Yapısal (SR/EMA)', 'ATR x 1.5–2', 'Trailing / zaman stopu — PPT Slayt 11']
  };
}

module.exports = { buildRiskOzet };
