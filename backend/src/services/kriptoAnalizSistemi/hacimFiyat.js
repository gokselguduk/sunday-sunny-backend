/**
 * PPT Slayt 10 — Hacim-fiyat ilişkisi (basit kural seti).
 */
function buildHacimFiyat(signal) {
  const trend = signal.volume?.trend || 'NORMAL';
  const pc = Number(signal.priceChange24h) || 0;
  const yukselis = pc > 0.5;
  const dusus = pc < -0.5;

  let profil = 'BELIRSIZ';
  let aciklama = '24s hareket veya hacim trendi nötr.';

  if (yukselis && trend === 'ARTIYOR') {
    profil = 'GUC_BULL';
    aciklama = 'Yükselen fiyat + artan hacim — sağlıklı boğa (PPT).';
  } else if (yukselis && trend === 'AZALIYOR') {
    profil = 'UYARI_BULL';
    aciklama = 'Yükselen fiyat + azalan hacim — trend zayıflıyor olabilir (PPT).';
  } else if (dusus && trend === 'ARTIYOR') {
    profil = 'GUC_BEAR';
    aciklama = 'Düşen fiyat + yüksek hacim — satıcı baskısı (PPT).';
  } else if (dusus && trend === 'AZALIYOR') {
    profil = 'BELIRSIZ_DIP';
    aciklama = 'Düşen fiyat + düşük hacim — alıcı yok; dip için ek konfirmasyon gerekir (PPT).';
  }

  const footprintNot =
    signal.footprint?.strongBear && yukselis
      ? 'Footprint güçlü ayı — fiyat yukarı görünse bile gizli satış baskısı ihtimali (PPT: CVD benzeri uyarı).'
    : signal.footprint?.strongBull && dusus
      ? 'Footprint güçlü boğa — düşüşte alım baskısı ihtimali.'
    : null;

  return {
    hacimTrend: trend,
    fiyat24sYuzde: pc,
    profil,
    aciklama,
    footprintNot,
    ileriSeviyeNot: 'CVD, Volume Profile POC, likidite haritası — ayrı veri/hesap gerekir (PPT Slayt 10).'
  };
}

module.exports = { buildHacimFiyat };
