/**
 * PPT Slayt 8 — Makro (FRED: Fed, M2, USD endeksi, 10Y).
 */
function buildMakroKatman(_signal, ctx = {}) {
  const m = ctx.makro;
  if (m && typeof m === 'object' && m.entegre) {
    return {
      entegre: true,
      kaynak: m.kaynak,
      fetchedAt: m.fetchedAt,
      maddeler: m.maddeler,
      uyumlulukLong: m.uyumlulukLong,
      etfNot: m.etfNot,
      cached: m.cached,
      ozet:
        m.uyumlulukLong === 'DESTEK'
          ? 'DXY düşüş eğilimi vb. — risk varlıkları için PPT’ye göre daha elverişli bağlam (tek başına yeterli değil).'
          : m.uyumlulukLong === 'BASKI'
            ? 'DXY güçleniyor — kripto için baskı ipucu (PPT: makro + teknik birlikte okunur).'
            : 'Makro veri alındı; uyum nötr veya karışık.'
    };
  }
  return {
    entegre: false,
    slayt: 8,
    reason: m?.reason || 'FRED_API_KEY tanımlı değil',
    baslik: 'Makro filtre',
    maddeler: [
      { kod: 'FED', durum: 'VERI_YOK', not: 'FRED DFF — FRED_API_KEY' },
      { kod: 'DXY_PROXY', durum: 'VERI_YOK', not: 'FRED DTWEXBGS' },
      { kod: 'M2', durum: 'VERI_YOK', not: 'FRED M2SL' },
      { kod: 'US10Y', durum: 'VERI_YOK', not: 'FRED DGS10' },
      { kod: 'ETF', durum: 'MANUEL', not: 'BTC_ETF_FLOW_NOT veya harici akış API’leri' }
    ],
    ozet: 'FRED_API_KEY ile otomatik dolar. ETF satırı manuel/harici (PPT).'
  };
}

module.exports = { buildMakroKatman };
