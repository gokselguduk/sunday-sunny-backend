/**
 * PPT Slayt 9 — Çoklu zaman dilimi (MTF).
 * Haftalık (1W) varsa üst trend olarak kullanılır; yoksa günlük vekil kalır.
 */
function buildMtfUyumu(signal) {
  const d = signal.mtfDetay || {};
  const hasW = !!d.hasWeekly;
  const WW = hasW ? d.dir1w : d.dir1d;
  const D1 = d.dir1d;
  const H4 = d.dir4h;
  const H1 = d.dir1h;

  const yukari = (x) => x > 0;
  const asagi = (x) => x < 0;
  const notr = (x) => x === 0;

  let kararKodu = 'BEKLE';
  let kararMetni = 'Üst trend veya alt TF uyumsuz; PPT: bekle veya küçük pozisyon.';
  let guven = 'DUSUK';

  if (yukari(WW) && yukari(H4) && yukari(H1)) {
    if (hasW && asagi(D1)) {
      kararKodu = 'BEKLE_DUZELTME';
      kararMetni = 'Haftalık boğa ama günlük ayı — düzeltme sürebilir (PPT).';
      guven = 'DUSUK';
    } else {
      kararKodu = 'AL_MAKSIMUM_GUVEN';
      kararMetni = hasW
        ? '1W+4H+1H boğa hizası (günlük uyumlu veya nötr) — PPT: AL, yüksek güven.'
        : '1D+4H+1H boğa hizası — PPT tablosu: AL, maksimum güven (haftalık veri yok).';
      guven = 'YUKSEK';
    }
  } else if (asagi(WW) && asagi(H4) && asagi(H1)) {
    kararKodu = 'SHORT_MAKSIMUM';
    kararMetni = hasW
      ? 'Haftalık+4H+1H ayı hizası — PPT: short maksimum güven (yön onaylıysa).'
      : 'Tam ayı hizası (günlük vekili) — PPT: short maksimum güven.';
    guven = 'YUKSEK';
  } else if (yukari(WW) && yukari(H4) && notr(H1)) {
    kararKodu = 'AL_BEKLE';
    kararMetni = 'Üst TF’ler boğa, 1H nötr — biraz bekle / hassas giriş.';
    guven = 'ORTA';
  } else if (yukari(WW) && notr(H4) && yukari(H1)) {
    kararKodu = 'KUCUK_POZISYON';
    kararMetni = 'Haftalık/günlük vekili boğa, 4H nötr, 1H boğa — küçük pozisyon.';
    guven = 'ORTA';
  } else if (yukari(WW) && asagi(H4)) {
    kararKodu = 'BEKLE_DUZELTME';
    kararMetni = 'Üst trend boğa ama 4H ayı — düzeltme sürebilir, long için bekle.';
    guven = 'DUSUK';
  } else if (asagi(WW)) {
    kararKodu = 'LONG_ACMA';
    kararMetni = hasW
      ? 'Haftalık ayı hattında — güvenli long yok (PPT).'
      : 'Günlük ayı vekili — güvenli long yok.';
    guven = 'LONG_YOK';
  }

  return {
    vekil: {
      haftalik1W: hasW ? d.dir1w : null,
      gunluk1D: D1,
      saat4H: H4,
      saat1H: H1,
      dakika15: d.dir15m
    },
    tumHizali: !!d.allAligned,
    kararKodu,
    kararMetni,
    guven,
    altinKuralNot: hasW
      ? 'PPT: Haftalık trend ile hizalanma kullanılıyor (1W mum).'
      : 'Haftalık mum yok veya yetersiz; günlük skor üst trend vekili.'
  };
}

module.exports = { buildMtfUyumu };
