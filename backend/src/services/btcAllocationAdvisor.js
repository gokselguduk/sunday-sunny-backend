/**
 * BTC nabzına göre "nakitin ne kadarını riske açma" bandı — sezgisel model, yatırım tavsiyesi değil.
 * Çoklu göstergeyi tek skorda birleştirir; açıklamalar eğitim amaçlıdır.
 */

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

/**
 * @param {object} snap — btcPulse snapshot (ok:true)
 */
function computeCashAllocation(snap) {
  if (!snap || !snap.ok) return null;

  const sent = snap.sentiment || {};
  const m = snap.mtf || {};
  const reg = snap.regime || {};
  const h1 = snap.h1 || {};
  const ob = snap.orderBook || {};
  const an = h1.anomaly || {};
  const pc24 = Number(snap.priceChange24h);
  const fg = sent.value != null ? Number(sent.value) : null;
  const rsi = h1.rsi != null ? Number(h1.rsi) : null;
  const atrp = h1.atrPercent != null ? Number(h1.atrPercent) : null;
  const score1h = h1.score != null ? Number(h1.score) : 0;
  const dir1h = m.dir1h != null ? Number(m.dir1h) : 0;
  const macdH = h1.macdHistogram != null ? Number(h1.macdHistogram) : null;
  const ofs = ob.orderFlowScore != null ? Number(ob.orderFlowScore) : 0;

  /** @type {{ id: string, baslik: string, katki: number, aciklama: string }[]} */
  const faktorler = [];
  let adj = 0;

  // ── Fear & Greed ──
  if (fg != null && Number.isFinite(fg)) {
    let k = 0;
    let ac = '';
    if (fg <= 20) {
      k = 4;
      ac =
        'Aşırı korku bölgesi: tarihsel olarak dönüş dönemleriyle çakışabilir; ancak trend hâlâ aşağıdaysa “bıçak tutma” riski yüksektir. Modele hafif pozitif katkı verdik.';
    } else if (fg < 40) {
      k = 3;
      ac = 'Korku bölgesi: risk iştahı düşük; seçici alım için alan olabilir, disiplin şart.';
    } else if (fg <= 55) {
      k = 0;
      ac = 'Nötr band: duygu tarafı aşırı uçta değil; teknik yapı daha belirleyici.';
    } else if (fg < 75) {
      k = -4;
      ac = 'Açgözlülük tarafı: FOMO ve düzeltme riski artar; yeni girişlerde pozisyon küçültme eğilimi.';
    } else {
      k = -9;
      ac = 'Aşırı açgözlülük: genelde kısa vadede tersine dönüş ihtimali konuşulur; model agresifliği kısar.';
    }
    adj += k;
    faktorler.push({ id: 'fg', baslik: 'Fear & Greed', katki: k, aciklama: ac });
  }

  // ── MTF yapı ──
  {
    let k = 0;
    let ac = '';
    if (m.allAligned) {
      if (dir1h > 0) {
        k = 11;
        ac =
          '15m–1H–4H–1D aynı yönde (yükseliş): trend uyumu güçlü; nakit ayırımını kademeli artırmayı düşünebileceğin senaryolarda model daha yapıcı kalır.';
      } else if (dir1h < 0) {
        k = -13;
        ac =
          'Tüm zaman dilimleri aşağı hizalı: bıçak avcılığı yerine bekleyiş / hedge düşüncesi daha ağır basar; model riski kısar.';
      } else {
        k = -2;
        ac = 'Zaman dilimleri hizalı ama 1H nötr: net trend yok, ihtiyat.';
      }
    } else if (m.mtfKonfirm) {
      if (dir1h > 0) {
        k = 5;
        ac = 'Kısmi MTF onayı (1H pozitif): yapı iyileşiyor ama tam hizadan daha zayıf.';
      } else {
        k = -5;
        ac = 'Kısmi onay ama 1H zayıf veya karışık: pozisyon boyutunu sınırlamak mantıklı.';
      }
    } else {
      const d4 = m.dir4h != null ? Number(m.dir4h) : 0;
      if (dir1h > 0 && d4 > 0) {
        k = 3;
        ac = '1H ve 4H aynı yönde (yukarı): orta vade ile kısa vade uyumu pozitif ama 4TF tam değil.';
      } else if (dir1h < 0 && d4 < 0) {
        k = -6;
        ac = '1H ve 4H aşağı: düşüş yapısı baskın; yeni long için nakit payını düşük tutmak model önerisi.';
      } else {
        k = -4;
        ac = 'Zaman dilimleri çelişkili: whipsaw riski; küçük pozisyon veya bekleme.';
      }
    }
    adj += k;
    faktorler.push({ id: 'mtf', baslik: 'Çoklu zaman (MTF)', katki: k, aciklama: ac });
  }

  // ── Rejim + 24s hareket ──
  {
    const tip = reg.type || 'TREND';
    let k = 0;
    let ac = `Rejim: ${tip}. `;
    if (tip === 'BREAKOUT') {
      if (pc24 > 0) {
        k += 6;
        ac += 'Kırılım + pozitif 24s: momentum lehte; yine de geri çekilme (fakeout) ihtimaline karşı kademeli girilir.';
      } else {
        k -= 9;
        ac += 'Kırılım etiketi ama 24s negatif: boğa tuzağı / dağıtım ihtimali; model ihtiyatlı.';
      }
    } else if (tip === 'RANGE') {
      k -= 4;
      ac += 'Yatay bant: sık stop patlatma; kenardan orta noktaya doğru dalgalanma beklenir, tam pozisyon açmak zor.';
    } else if (tip === 'SPIKE_LOW_VOL') {
      k -= 7;
      ac += 'Düşük hacimli sert hareket: likidite kırılgan; büyük pozisyon önerilmez.';
    } else {
      k += reg.regimeScore > 0 ? 2 : reg.regimeScore < 0 ? -2 : 0;
      ac += 'Trend benzeri yapı: rejim skoru modele hafif yön verir.';
    }
    if (Number.isFinite(pc24)) {
      if (pc24 <= -10) {
        k -= 10;
        ac += ` 24s %${pc24.toFixed(1)}: panik satış bölgesine yakın hareket; ortalama düşürmek yerine bekleme tercih edilir.`;
      } else if (pc24 < -5) {
        k -= 5;
        ac += ` 24s zayıf (%${pc24.toFixed(1)}): risk primi artar.`;
      } else if (pc24 >= 14) {
        k -= 5;
        ac += ` 24s çok güçlü (%${pc24.toFixed(1)}): kısa vadede aşırı uzama; kâr realizasyonu baskısı.`;
      } else if (pc24 >= 8) {
        k -= 2;
        ac += ` 24s güçlü (%${pc24.toFixed(1)}): kademeli giriş, tek seferde all-in değil.`;
      }
    }
    adj += k;
    faktorler.push({ id: 'rejim', baslik: 'Rejim ve 24s momentum', katki: k, aciklama: ac });
  }

  // ── 1H sistem skoru ──
  {
    const k = clamp(score1h, -12, 12) * 0.55;
    const rk = round1(k);
    adj += k;
    faktorler.push({
      id: 'skor1h',
      baslik: '1H teknik skor',
      katki: rk,
      aciklama: `Dahili skor ${score1h.toFixed(1)} (normalize edildi). Pozitif = yapı ve sinyaller lehte; negatif = satış baskısı / zayıf yapı.`
    });
  }

  // ── RSI ──
  if (rsi != null && Number.isFinite(rsi)) {
    let k = 0;
    let ac = '';
    if (rsi >= 74) {
      k = -6;
      ac = 'RSI aşırı alım: düzeltme olasılığı; yeni agresif long için nakit payı düşük tutulur.';
    } else if (rsi <= 28) {
      k = 4;
      ac = 'RSI aşırı satım: tepki alımı senaryosu olabilir; trend aşağıysa yine de dikkat.';
    } else {
      ac = 'RSI nötr bantta: aşırı uç uyarısı yok.';
    }
    adj += k;
    faktorler.push({ id: 'rsi', baslik: 'RSI (1H)', katki: k, aciklama: ac });
  }

  // ── ATR% (volatilite vergisi) ──
  if (atrp != null && Number.isFinite(atrp)) {
    let k = 0;
    if (atrp >= 4.5) k = -12;
    else if (atrp >= 3.5) k = -8;
    else if (atrp >= 2.5) k = -4;
    else if (atrp >= 1.8) k = -1;
    const ac = `ATR/fiyat ~%${atrp.toFixed(2)}: volatilite yüksekse aynı nominal pozisyon daha fazla stop riski taşır; model buna “vergi” uygular.`;
    adj += k;
    faktorler.push({ id: 'atr', baslik: 'Volatilite (ATR%)', katki: k, aciklama: ac });
  }

  // ── Emir defteri ──
  {
    let k = 0;
    if (ofs >= 2.5) k = 4;
    else if (ofs >= 1) k = 2;
    else if (ofs <= -2.5) k = -4;
    else if (ofs <= -1) k = -2;
    if (ob.bullish && k >= 0) k += 1;
    if (ob.bearish && k <= 0) k -= 1;
    const ac = `Order flow skoru ${ofs.toFixed(1)}; bid/ask oranı ve derinlik dengesi kısa vadeli baskıyı yansıtır (kesin yön garantisi değil).`;
    adj += k;
    faktorler.push({ id: 'ob', baslik: 'Emir defteri (order flow)', katki: k, aciklama: ac });
  }

  // ── MACD histogram ──
  if (macdH != null && Number.isFinite(macdH)) {
    let k = 0;
    if (macdH > 0 && dir1h >= 0) k = 2;
    else if (macdH < 0 && dir1h <= 0) k = -2;
    else if (macdH > 0 && dir1h < 0) k = -1;
    else if (macdH < 0 && dir1h > 0) k = 1;
    adj += k;
    faktorler.push({
      id: 'macd',
      baslik: 'MACD histogram',
      katki: k,
      aciklama:
        k > 0
          ? 'Momentum pozitif veya düşüşte yavaşlama işareti — yapıya küçük pozitif katkı.'
          : k < 0
            ? 'Momentum negatif veya yükselişte zayıflama — ihtiyat.'
            : 'Histogram nötr veya MTF ile çelişkili; etki sınırlı.'
    });
  }

  // ── Anomali ──
  if (an.isAnomaly) {
    let k = -5;
    let ac = an.reason || 'Anomali bayrağı açık.';
    if (an.signal === 'MANIPULASYON') {
      k = -22;
      ac = 'Manipülasyon / olağandışı davranış işareti: model maksimum nakit payını sert şekilde sınırlar.';
    } else if (an.signal === 'ASIRI_VOLATILITE') {
      k = -10;
      ac = 'Aşırı volatilite anomalisi: geniş stop ve sürpriz mum riski; pozisyon küçültülür.';
    }
    adj += k;
    faktorler.push({ id: 'anom', baslik: 'Anomali filtresi', katki: k, aciklama: ac });
  }

  const base = 20;
  const ham = base + adj * 0.95;
  let orta = round1(clamp(ham, 5, 52));

  let tavan = 52;
  if (an.signal === 'MANIPULASYON') tavan = 10;

  orta = Math.min(orta, tavan);

  const genislik = atrp != null && atrp > 3 ? 12 : atrp != null && atrp > 2 ? 10 : 8;
  let minPct = Math.round(clamp(orta - genislik, 3, 50));
  let maxPct = Math.round(clamp(orta + genislik, 5, 55));
  if (maxPct < minPct) [minPct, maxPct] = [maxPct, minPct];
  if (an.signal === 'MANIPULASYON') {
    maxPct = Math.min(maxPct, 12);
    minPct = Math.min(minPct, 8);
  }

  /** @type {'temkinli'|'dengeli'|'yapici'|'agresif'} */
  let profil = 'dengeli';
  if (orta < 14) profil = 'temkinli';
  else if (orta < 24) profil = 'dengeli';
  else if (orta < 38) profil = 'yapici';
  else profil = 'agresif';

  const profilTr = {
    temkinli: 'Temkinli',
    dengeli: 'Dengeli',
    yapici: 'Yapıcı',
    agresif: 'Agresif (üst bant)'
  };

  const guven =
    Math.abs(adj) < 8 ? 'dusuk' : Math.abs(adj) < 18 ? 'orta' : 'yuksek';
  const guvenTr = { dusuk: 'düşük (sinyaller çelişkili)', orta: 'orta', yuksek: 'yüksek (sinyaller uyumlu)' };

  const ozet = `Bu ortamda model, serbest nakitin yaklaşık %${minPct}–%${maxPct} bandında (merkez ~%${Math.round(
    orta
  )}) kripto (özellikle BTC) riskine ayrılmasını çerçeveler. Profil: ${profilTr[profil]}. Faktör uyumu: ${guvenTr[guven]}.`;

  return {
    ortaPct: Math.round(orta),
    minPct,
    maxPct,
    profil,
    profilLabel: profilTr[profil],
    guven,
    guvenLabel: guvenTr[guven],
    ozet,
    faktorler,
    toplamAyarlama: round1(adj),
    yontem:
      'Çok faktörlü skor: Fear & Greed, MTF hizası, rejim, 24s getiri, 1H skor, RSI, ATR%, order flow, MACD ve anomali cezası birleştirilir; ardından %5–%55 aralığına sıkıştırılır. Tek bir göstergeye körü körüne güvenilmez.',
    uyari:
      'Bu çıktı yatırım tavsiyesi değildir. Kişisel durum, borç, gelir, zaman ufku ve toleransınız modele dahil edilmemiştir. Kaybetmeyi göze alabileceğiniz tutarı aşmayın.'
  };
}

/**
 * Piyasa dönemi + nakitte kal + kripto dilimi içi dağılım (BTC nabzı verisine dayalı, eğitim amaçlı).
 * @param {object} snap
 * @param {object|null} alloc computeCashAllocation çıktısı
 */
function computePortfolioGuide(snap, alloc) {
  if (!snap?.ok || !alloc) return null;

  const m = snap.mtf || {};
  const sent = snap.sentiment || {};
  const reg = snap.regime || {};
  const h1 = snap.h1 || {};
  const an = h1.anomaly || {};
  const pc24 = Number(snap.priceChange24h);
  const fg = sent.value != null ? Number(sent.value) : null;

  /** @type {{ kod: string, baslik: string, ozet: string, renk: 'green'|'red'|'amber'|'accent' }} */
  let donem = {
    kod: 'notr_denge',
    baslik: 'Dengeli / yön ayrışmıyor',
    ozet:
      'Fear & Greed ve zaman dilimleri tek yönde değil; ani büyük hamle yerine küçük adımlar ve sabır genelde daha güvenli çerçeve olarak okunur.',
    renk: 'amber'
  };

  if (an.signal === 'MANIPULASYON') {
    donem = {
      kod: 'manip_ihtiyat',
      baslik: 'Olağandışı piyasa davranışı',
      ozet:
        'Manipülasyon / olağandışı hareket bayrağı açık. Bu dönemlerde likidite kırılgan olur; büyük pozisyon ve kaldıraç yerine gözlem ve nakit ağırlığı öne çıkar.',
      renk: 'red'
    };
  } else if (an.isAnomaly && an.signal === 'ASIRI_VOLATILITE') {
    donem = {
      kod: 'vol_firtina',
      baslik: 'Yüksek volatilite dönemi',
      ozet:
        'Geniş mum aralıkları ve sürpriz hareket olasılığı artar. Pozisyonları küçültmek, stop mesafelerini gerçekçi tutmak ve “tek seferde all-in”den kaçınmak modelin mesajıdır.',
      renk: 'amber'
    };
  } else if (m.allAligned && (m.dir1h || 0) > 0 && fg != null && fg < 65) {
    donem = {
      kod: 'risk_on_yapi',
      baslik: 'Risk-on yapı (trend uyumu)',
      ozet:
        'Kısa–orta–uzun vade aynı yönde ve duygu henüz aşırı değil. Bu tip ortamlarda trend takipçileri için kademeli ekleme konuşulur; yine de teknik bozulmada çıkış planı şart.',
      renk: 'green'
    };
  } else if (fg != null && fg <= 22 && (m.dir1h || 0) >= 0) {
    donem = {
      kod: 'korku_contra',
      baslik: 'Derin korku / olası dip bölgesi',
      ozet:
        'Duygu çok düşük; tarihte bazen dönüş öncesi görülür ama “düşen bıçak” riski her zaman vardır. DCA veya çok küçük tranche ile deneme, tam pozisyonu tek mumda açmama yaklaşımı önerilir.',
      renk: 'accent'
    };
  } else if (fg != null && fg >= 78) {
    donem = {
      kod: 'asiri_hirs',
      baslik: 'Aşırı açgözlülük / konsolidasyon riski',
      ozet:
        'Geniş kitlenin FOMO ile girdiği dönemlerde düzeltme ihtimali artar. Kâr realizasyonu, yeni girişleri küçültme ve nakit/stabil oranını artırma model tarafından desteklenir.',
      renk: 'red'
    };
  } else if ((m.dir1h || 0) < 0 && (m.dir4h || 0) < 0) {
    donem = {
      kod: 'risk_off_trend',
      baslik: 'Risk-off eğilim (aşağı trend)',
      ozet:
        '1H ve 4H aşağı hizalı; savunmacı duruş ve nakit birikimi öne çıkar. Altcoin avcılığı yerine BTC/ETH gibi likiditesi yüksek çekirdek veya tamamen bekleme düşünülebilir.',
      renk: 'red'
    };
  } else if (reg.type === 'RANGE') {
    donem = {
      kod: 'yatay_bant',
      baslik: 'Yatay bant / sıkışma',
      ozet:
        'Kırılım öncesi sıkışma dönemleri whipsaw üretir; kenarları kovalamak yerine net kırılım veya destek/direnç teyidi beklemek ve pozisyonu sınırlı tutmak mantıklıdır.',
      renk: 'amber'
    };
  } else if (reg.type === 'BREAKOUT' && pc24 > 5) {
    donem = {
      kod: 'kirilim_momentum',
      baslik: 'Kırılım + momentum',
      ozet:
        'Volatilite ve hızlı hareket artmış olabilir; fırsat gibi görünse de geri çekilme (fakeout) riskine karşı kademeli giriş ve stop disiplini önemlidir.',
      renk: 'green'
    };
  }

  const nakitMin = Math.round(Math.max(0, 100 - alloc.maxPct));
  const nakitMax = Math.round(Math.min(100, 100 - alloc.minPct));
  const nakitOrta = Math.round(100 - alloc.ortaPct);

  let btc = 46;
  let alt = 34;
  let stab = 20;

  if (donem.kod === 'manip_ihtiyat' || donem.kod === 'risk_off_trend') {
    btc = 62;
    alt = 18;
    stab = 20;
  } else if (donem.kod === 'risk_on_yapi' || donem.kod === 'kirilim_momentum') {
    btc = 40;
    alt = 42;
    stab = 18;
  } else if (donem.kod === 'korku_contra') {
    btc = 48;
    alt = 28;
    stab = 24;
  } else if (donem.kod === 'asiri_hirs') {
    btc = 52;
    alt = 23;
    stab = 25;
  } else if (donem.kod === 'vol_firtina') {
    btc = 50;
    alt = 25;
    stab = 25;
  } else if (donem.kod === 'yatay_bant') {
    btc = 44;
    alt = 36;
    stab = 20;
  }

  if (alloc.profil === 'temkinli') {
    stab += 8;
    alt -= 4;
    btc -= 4;
  } else if (alloc.profil === 'agresif') {
    alt += 6;
    stab -= 6;
  }

  const s = btc + alt + stab;
  btc = Math.round((btc / s) * 100);
  alt = Math.round((alt / s) * 100);
  stab = 100 - btc - alt;

  const kriptoIcinde = [
    {
      kod: 'btc',
      label: 'BTC (çekirdek / likidite)',
      pct: btc,
      not: 'Piyasa beta’sı ve likidite omurgası olarak model, riskli kısımda BTC payını referans alır; bu bir “sadece BTC al” tavsiyesi değildir.'
    },
    {
      kod: 'alt',
      label: 'Altcoin (seçici, yüksek risk)',
      pct: alt,
      not: 'Tahta / haber / volatilite riski yüksek; bu uygulamadaki skorları filtre olarak kullanıp sayıyı sınırlı tutmak genelde daha sürdürülebilir.'
    },
    {
      kod: 'stable',
      label: 'USDT / nakit bekleyiş',
      pct: stab,
      not: 'Fırsat, düzeltme veya DCA için sürtünmesiz bekleme alanı; “tamamen işleme gir” yerine esnek tampon.'
    }
  ];

  const genelOzet = `Özet çerçeve (tüm örnek serbest likiditenizi 100 birim varsayar — kira, borç, acil fon ayrı tutulmalıdır): ~%${nakitMin}–%${nakitMax} civarı kripto dışı / güvende kalabilir; ~%${alloc.minPct}–%${alloc.maxPct} bandı ise kripto riskine ayrılabilecek pay olarak okunur. Kriptoya ayırdığınız her 100 birim içinde kabaca %${btc} BTC · %${alt} seçici alt · %${stab} USDT/bekleyiş dağılımı bu rejime göre örneklenmiştir.`;

  const nakitAciklama =
    '“Nakitte kal” = acil ihtiyaç + kısa vadeli yükümlülük + psikolojik güven payı. Model, kriptoya girmeyen kısmı geniş tutmanızı volatilite ve ani haber riski nedeniyle destekler.';

  return {
    piyasaDonemi: donem,
    nakit: {
      minPct: nakitMin,
      maxPct: nakitMax,
      ortaPct: nakitOrta,
      aciklama: nakitAciklama
    },
    kriptoRiskBand: { minPct: alloc.minPct, maxPct: alloc.maxPct, ortaPct: alloc.ortaPct },
    kriptoIcinde,
    genelOzet,
    stratejiNotu:
      'Borçla kripto almayın; tek pozisyonda portföyünüzün tamamını riske atmayın. Bu sekme BTC (USDT-M) verisiyle güncellenir; altcoin gerçekliği daha çarpıcı olabilir.',
    uyari: alloc.uyari
  };
}

module.exports = { computeCashAllocation, computePortfolioGuide };
