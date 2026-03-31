const { SEZON } = require('./constants');

/**
 * PPT: Boğa / Ayı / Nötr / Korku — mevcut pipeline verisiyle sezonsal etiket.
 * On-chain (MVRV, NUPL, SOPR) yok; duygu + MTF + RSI + 24s hareket kullanılır.
 */
function detectSeason(signal) {
  const fg = signal.sentiment?.value;
  const extFear = !!signal.sentiment?.isExtremeFear;
  const fear = !!signal.sentiment?.isFear;
  const extGreed = !!signal.sentiment?.isExtremeGreed;

  const rsi = typeof signal.rsi === 'number' ? signal.rsi : 50;
  const pc = Number(signal.priceChange24h) || 0;
  const d = signal.mtfDetay || {};
  const d1 = d.dir1d || 0;
  const d4 = d.dir4h || 0;
  const d1h = d.dir1h || 0;
  const alignedBull = d1 > 0 && d4 > 0 && d1h > 0;
  const alignedBear = d1 < 0 && d4 < 0 && d1h < 0;

  let kod = SEZON.NOTR;
  const gerekceler = [];

  if (extFear || (rsi < 28 && pc <= -7)) {
    kod = SEZON.KORKU;
    gerekceler.push('Aşırı korku veya sert düşüş + düşük RSI');
  } else if (alignedBear || (d1 < 0 && pc < -5)) {
    kod = SEZON.AYI;
    gerekceler.push('Günlük/4s/1s düşüş hizası veya zayıf günlük + negatif 24s');
  } else if (alignedBull && pc >= 0 && !extGreed) {
    kod = SEZON.BOGA;
    gerekceler.push('MTF yükseliş hizası ve pozitif/ nötr 24s');
  } else if (signal.regime?.type === 'RANGE' || d1 === 0 || (d1 > 0 && d4 < 0)) {
    kod = SEZON.NOTR;
    gerekceler.push('Range rejimi veya karışık zaman dilimi');
  } else if (extGreed && rsi > 78) {
    kod = SEZON.NOTR;
    gerekceler.push('Aşırı heves + yüksek RSI — PPT’de boğa sonu riski; nötr etiket');
  } else if (d1 > 0) {
    kod = SEZON.BOGA;
    gerekceler.push('Günlük skor pozitif, hizalama kısmi');
  } else {
    kod = SEZON.AYI;
    gerekceler.push('Varsayılan: savunmacı (günlük zayıf veya negatif)');
  }

  const etiket = {
    [SEZON.BOGA]: 'Boğa',
    [SEZON.AYI]: 'Ayı',
    [SEZON.NOTR]: 'Nötr',
    [SEZON.KORKU]: 'Korku / panik'
  };

  return {
    kod,
    etiket: etiket[kod] || kod,
    gerekceler,
    not: 'Sezon: teknik+duygu vekili; Slayt 2–7’deki on-chain doğrulaması entegrasyonla güçlenir.'
  };
}

module.exports = { detectSeason };
