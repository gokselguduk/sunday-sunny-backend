/**
 * Sunum dosyasındaki ana aşamalar — her biri durum + kısa özet (entegre / bekliyor).
 */
function buildPptAsamalari(ka) {
  const sez = ka?.sezon?.etiket || '—';
  const mtfOk = ka?.mtfUyumu?.guven === 'YUKSEK' || ka?.mtfUyumu?.guven === 'ORTA';
  const hf = ka?.hacimFiyat?.profil;
  const makro = ka?.makroKatman?.entegre;
  const oc = ka?.onChainKatman?.entegre;

  return [
    { slayt: 2, kod: 'SEZON_AKISI', baslik: 'Sezon akışı & geçiş dinamiği', durum: 'REFERANS', ozet: 'Birikim → boğa → zirve → panik → ayı (PPT).' },
    {
      slayt: '3–4',
      kod: 'BOGA_CERCEVE',
      baslik: 'Boğa sezonu — yapı + teknik',
      durum: sez === 'Boğa' ? 'AKTIF' : 'BILGI',
      ozet: sez === 'Boğa' ? 'Piyasa boğa etiketiyle uyumlu sinyal seti.' : 'Şu anki sezon: ' + sez + '.'
    },
    {
      slayt: '5–6',
      kod: 'AYI_CERCEVE',
      baslik: 'Ayı sezonu — yapı + teknik',
      durum: sez === 'Ayı' ? 'AKTIF' : 'BILGI',
      ozet: sez === 'Ayı' ? 'Ayı çerçevesi — long tarafında düşük güven.' : 'Ayı filtresi devrede.'
    },
    {
      slayt: 7,
      kod: 'NOTR_KORKU',
      baslik: 'Nötr & korku / panik',
      durum: sez === 'Nötr' || sez === 'Korku / panik' ? 'AKTIF' : 'BILGI',
      ozet: 'Range / şok davranışı PPT ile eşleştirildi.'
    },
    {
      slayt: 8,
      kod: 'MAKRO',
      baslik: 'Makro ekonomi katmanı',
      durum: makro ? 'ENTEGRE' : 'BEKLIYOR',
      ozet: makro ? 'Harici makro veri bağlı.' : 'FED/DXY/M2/ETF — ctx.makro ile bağlanacak.'
    },
    {
      slayt: 9,
      kod: 'MTF',
      baslik: 'Çoklu zaman dilimi',
      durum: mtfOk ? 'UYGULANDI' : 'ZAYIF',
      ozet: ka?.mtfUyumu?.kararMetni || '—'
    },
    {
      slayt: 10,
      kod: 'HACIM_FIYAT',
      baslik: 'Hacim–fiyat ilişkisi',
      durum: hf && hf !== 'BELIRSIZ' ? 'UYGULANDI' : 'NÖTR',
      ozet: ka?.hacimFiyat?.aciklama || '—'
    },
    {
      slayt: 11,
      kod: 'RISK_ODUL',
      baslik: 'Risk / ödül',
      durum: Number(ka?.riskOzet?.riskReward) >= 2 ? 'UYGUN' : 'KONTROL',
      ozet: `R:R ${ka?.riskOzet?.riskReward ?? '—'} · ${ka?.riskOzet?.rrDegerlendirme || ''}`
    },
    { slayt: 12, kod: 'PSIKOLOJI', baslik: 'Psikoloji & davranış', durum: 'REFERANS', ozet: 'FOMO, stop iptali, overtrading — sabit uyarı listesi.' },
    { slayt: 13, kod: 'EMIRLER', baslik: 'Emir tipleri & ölçekleme', durum: 'REFERANS', ozet: 'Market/limit/OCO/trailing — kullanıcı disiplini.' },
    {
      slayt: '14–15',
      kod: 'CHECKLIST_20',
      baslik: '20 sorulu onay',
      durum: 'KISMEN_OTOMATIK',
      ozet: ka?.checklist20?.ozet?.yorum || '—'
    },
    { slayt: 16, kod: 'EVRENSEL', baslik: 'Evrensel kurallar', durum: 'REFERANS', ozet: '6 kural sabit listede.' },
    {
      slayt: 17,
      kod: 'HIZLI_BASVURU',
      baslik: 'Hızlı başvuru (gösterge × sezon)',
      durum: oc ? 'TAM' : 'TEKNIK_ONLY',
      ozet: oc ? 'On-chain tablo bağlı.' : 'BTC/alt on-chain tabloları veri gelince dolar.'
    },
    {
      slayt: 18,
      kod: 'OZET',
      baslik: 'Sistem özeti',
      durum: 'AKTIF',
      ozet: ka?.ozetCumle || 'Çoklu katman uyumu.'
    }
  ];
}

module.exports = { buildPptAsamalari };
