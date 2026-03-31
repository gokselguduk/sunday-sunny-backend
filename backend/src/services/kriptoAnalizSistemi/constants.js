/**
 * Kaynak: Masaüstü kripto_analiz_sistemi.pptx — "Maksimum Başarı Analiz Sistemi"
 * (Sezon akışı, makro, MTF, hacim-fiyat, risk, psikoloji, 20 soru checklist, vb.)
 */
module.exports = {
  SYSTEM_ID: 'kripto_analiz_sistemi',
  SYSTEM_VERSION: '1.0.0',
  KAYNAK_DOKUMAN: 'kripto_analiz_sistemi.pptx',

  SEZON: {
    BOGA: 'BOGA',
    AYI: 'AYI',
    NOTR: 'NOTR',
    KORKU: 'KORKU'
  },

  /** Slayt 16 — evrensel kurallar (özet metin) */
  EVRENSEL_KURALLAR: [
    'Tek göstergeye güvenme — zincir (teknik + duygu + mümkünse on-chain) uyuşmuyorsa bekle.',
    'Zaman dilimini karıştırma — hangi TF ile trade ettiğini net tut (burada 1D ≈ üst trend vekili).',
    'Kaldıraç sezon tanımaz — stop sweep riski her ortamda var.',
    'Plan yoksa analiz anlamsız — giriş, stop, çıkış önceden yazılmalı.',
    'Korelasyon — aynı yönlü birden fazla coin, fiilen riski katlar.',
    'Her işlemden öğren — günlük tutmak uzun vadeli edge.'
  ],

  /** Slayt 12 — kısa psikoloji hatırlatmaları */
  PSIKOLOJI_UYARILARI: [
    'FOMO: Yapı dışında, panikle değil planla hareket et.',
    'Stop iptali: “Geri döner” düşüncesi en sık görülen tuzak.',
    'Overtrading: Beklemek de pozisyondur.',
    'Zarar sonrası 24 saat kuralı (intikam işlemi yok).'
  ]
};
