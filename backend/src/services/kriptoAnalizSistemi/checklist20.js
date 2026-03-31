/**
 * PPT Slayt 14–15 — 20 soruluk checklist.
 * Otomatik olanlar sinyalden; psikoloji maddeleri kullanıcı onayı (bilinmiyor).
 */
function item(no, katman, soru, durum, kaynak) {
  return { no, katman, soru, durum, kaynak };
}

function buildChecklist20(signal, mtf, makro, onChain) {
  const fg = signal.sentiment?.value;
  const rsi = typeof signal.rsi === 'number' ? signal.rsi : null;
  const d = signal.mtfDetay || {};
  const rr = signal.atr?.riskReward;
  const volOk =
    signal.volume?.trend === 'ARTIYOR' && (signal.priceChange24h || 0) > 0
      ? true
      : signal.volume?.trend === 'ARTIYOR' && (signal.priceChange24h || 0) < 0
        ? true
        : null;

  const cvdUyum =
    signal.footprint?.strongBear && (signal.priceChange24h || 0) > 0
      ? false
      : signal.footprint?.strongBull || !signal.footprint?.strongBear
        ? true
        : null;

  const makroRow1 = !makro?.entegre
    ? 'BILINMIYOR'
    : makro.uyumlulukLong === 'DESTEK'
      ? 'EVET'
      : makro.uyumlulukLong === 'BASKI'
        ? 'HAYIR'
        : 'KISMEN';

  const mvrvZ = onChain?.metrikler?.find((m) => m.kod === 'MVRV_Z')?.deger;
  const longBias = String(signal.overallSignal || '').includes('BUY');
  let onChainRow3 = 'BILINMIYOR';
  if (onChain?.entegre && mvrvZ != null && Number.isFinite(mvrvZ)) {
    if (mvrvZ >= 7 && longBias) onChainRow3 = 'HAYIR';
    else if (mvrvZ >= 3 && mvrvZ < 7 && longBias) onChainRow3 = 'EVET';
    else if (mvrvZ < 0 && longBias) onChainRow3 = 'KISMEN';
    else if (!longBias && mvrvZ < 3) onChainRow3 = 'KISMEN';
    else onChainRow3 = 'KISMEN';
  } else if (onChain?.entegre) onChainRow3 = 'KISMEN';

  const ustLongOk = d.hasWeekly ? d.dir1w > 0 : d.dir1d > 0;
  const ustShortOk = d.hasWeekly ? d.dir1w < 0 : d.dir1d < 0;

  const rows = [
    item(1, 'MAKRO', 'Makro ortam (FED, DXY, M2) long yönü destekliyor mu? (FRED)', makroRow1, 'makro'),
    item(2, 'SEZON', 'Mevcut sezon (boğa/ayı/nötr/korku) tanımlandı mı?', 'EVET', 'otomatik'),
    item(3, 'ON_CHAIN', 'MVRV Z (BTC) long için PPT aralığına uygun mu?', onChainRow3, 'onChain'),
    item(
      4,
      'TEKNIK',
      d.hasWeekly ? 'Haftalık (1W) üst trend long ile uyumlu mu?' : 'Günlük üst trend (1W yok) long ile uyumlu mu?',
      ustLongOk ? 'EVET' : ustShortOk ? 'HAYIR' : 'BILINMIYOR',
      'otomatik'
    ),
    item(
      5,
      'TEKNIK',
      '4 saatlik ve günlük aynı yönde mi (MTF)?',
      d.dir4h === d.dir1d && d.dir1d !== 0 ? 'EVET' : 'KISMEN',
      'otomatik'
    ),
    item(
      6,
      'TEKNIK',
      'EMA / trend yapısı (golden/death, strength) destekliyor mu?',
      (signal.trend?.strength || 0) >= 3 && d.dir1h > 0
        ? 'EVET'
        : (signal.trend?.strength || 0) <= 1 && d.dir1h < 0
          ? 'AYI_UYGUN'
          : 'KISMEN',
      'otomatik'
    ),
    item(
      7,
      'TEKNIK',
      'RSI aşırı alım/satım tuzağında mı? (Sezona göre farklı anlam)',
      rsi == null
        ? 'BILINMIYOR'
        : rsi > 85
          ? 'ASIRI_ALIM'
          : rsi < 15
            ? 'ASIRI_SATIM'
            : 'NORMAL',
      'otomatik'
    ),
    item(
      8,
      'TEKNIK',
      'Belirgin setup var mı? (MTF + yön sinyali)',
      mtf?.guven === 'YUKSEK' && signal.overallSignal?.includes('BUY')
        ? 'EVET'
        : mtf?.guven === 'ORTA' && signal.overallSignal?.includes('BUY')
          ? 'KISMEN'
          : 'HAYIR',
      'otomatik'
    ),
    item(9, 'HACIM', 'Hacim fiyatı destekliyor mu?', volOk === true ? 'EVET' : volOk === false ? 'HAYIR' : 'KISMEN', 'otomatik'),
    item(
      10,
      'HACIM',
      'Footprint / delta fiyatla çelişiyor mu?',
      cvdUyum === false ? 'CELIKI' : cvdUyum ? 'UYUMLU' : 'KISMEN',
      'otomatik'
    ),
    item(
      11,
      'YAPI',
      'Yakın önemli SR seviyesi blokluyor mu?',
      signal.supportResistance?.resistanceDistance != null &&
        signal.supportResistance.resistanceDistance < 1.5
        ? 'DIRENC_YAKIN'
        : signal.supportResistance?.nearestResistance
          ? 'KONTROL_ET'
          : 'BILINMIYOR',
      'yariOtomatik'
    ),
    item(
      12,
      'RISK',
      'Stop-loss mantıklı yapısal/ATR seviyesinde mi?',
      Number.isFinite(signal.atr?.stopLossPct) ? 'EVET' : 'BILINMIYOR',
      'otomatik'
    ),
    item(13, 'RISK', 'R:R en az 1:2 mi?', rr >= 2 ? 'EVET' : rr >= 1 ? 'KISMEN' : 'HAYIR', 'otomatik'),
    item(14, 'RISK', 'Pozisyon büyüklüğü max %2 risk? (hesap bazlı)', 'BILINMIYOR', 'kullanici'),
    item(15, 'RISK', 'Açık pozisyonlarla korelasyon hesaplandı mı?', 'BILINMIYOR', 'kullanici'),
    item(16, 'PSIKOLOJI', 'FOMO ile değil analiz ile mi açılıyor?', 'BILINMIYOR', 'kullanici'),
    item(17, 'PSIKOLOJI', 'İntikam işlemi değil mi?', 'BILINMIYOR', 'kullanici'),
    item(18, 'PSIKOLOJI', 'Uyku / stres normal mi?', 'BILINMIYOR', 'kullanici'),
    item(19, 'PSIKOLOJI', 'Planla mı uyumlu?', 'BILINMIYOR', 'kullanici'),
    item(20, 'PSIKOLOJI', 'Stop olursa duygusal kabul?', 'BILINMIYOR', 'kullanici'),
  ];

  const otomatik = rows.filter((r) => r.kaynak === 'otomatik');
  let evet = 0;
  let katilan = 0;
  for (const r of otomatik) {
    if (r.durum === 'EVET' || r.durum === 'UYUMLU' || r.durum === 'AYI_UYGUN') {
      evet++;
      katilan++;
    } else if (r.durum === 'HAYIR' || r.durum === 'CELIKI' || r.durum === 'ASIRI_ALIM') {
      katilan++;
    } else if (r.durum === 'KISMEN' || r.durum === 'NORMAL' || r.durum === 'KONTROL_ET') {
      katilan++;
      evet += 0.5;
    }
  }

  const puanOtomatik = Math.round(Math.min(20, (evet / Math.max(1, otomatik.length)) * 20));

  let yorum = 'Otomatik teknik taraması; tam 20/20 için kullanıcı maddeleri + makro/on-chain gerekir.';
  if (puanOtomatik >= 16) yorum += ' Teknik otomatik skor güçlü.';
  else if (puanOtomatik >= 12) yorum += ' Orta — eksik maddeleri tamamla.';
  else yorum += ' Düşük — PPT: <15 ise açma.';

  return {
    maddeler: rows,
    ozet: {
      otomatikPuanYaklasik: puanOtomatik,
      otomatikMaddeSayisi: otomatik.length,
      yorum,
      pptOlcek: '20/20 aç · 18–19 neredeyse · 15–17 küçük poz · <15 açma (PPT)'
    },
    mtfKararOzet: mtf?.kararMetni || null
  };
}

module.exports = { buildChecklist20 };
