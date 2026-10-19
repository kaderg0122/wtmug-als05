/* ============================================================
   Kamera Çevirmeni — Tesseract.js OCR + MyMemory Translation
   ============================================================ */

const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

/* ---------- Ayarlar ---------- */
const CONFIG = {
  MYMEMORY_URL: 'https://api.mymemory.translated.net/get',
  MAX_TEXT_LENGTH: 400, // MyMemory tek istekte 500 byte sınırı
  OCR_LANGUAGES: 'eng+tur+deu+fra+spa+ita+rus+ara+jpn+chi_sim+kor+por+nld+pol+ukr'
};

/* ---------- Durum ---------- */
const state = {
  stream: null,
  running: false,
  tesseractWorker: null,
  workerReady: false,
  processing: false,
  lastOcrText: ''
};

/* ---------- Elementler ---------- */
const els = {
  video: $('#video'),
  cameraFrame: $('#cameraFrame'),
  cameraStatus: $('#cameraStatus'),
  captureCanvas: $('#captureCanvas'),
  startCameraBtn: $('#startCameraBtn'),
  captureBtn: $('#captureBtn'),
  stopCameraBtn: $('#stopCameraBtn'),
  galleryInput: $('#galleryInput'),
  manualForm: $('#manualForm'),
  manualInput: $('#manualInput'),
  targetLang: $('#targetLang'),
  errorMsg: $('#errorMsg'),
  infoMsg: $('#infoMsg'),
  loading: $('#loading'),
  loadingText: $('#loadingText'),
  resultSection: $('#resultSection'),
  sourceText: $('#sourceText'),
  translatedText: $('#translatedText'),
  resultLangName: $('#resultLangName'),
  copySourceBtn: $('#copySourceBtn'),
  copyTranslatedBtn: $('#copyTranslatedBtn'),
  swIndicator: $('#swIndicator')
};

/* ============================================================
   YARDIMCILAR
   ============================================================ */
function showError(msg) {
  els.errorMsg.textContent = msg;
  els.errorMsg.hidden = false;
  els.infoMsg.hidden = true;
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { els.errorMsg.hidden = true; }, 6000);
}

function showInfo(msg) {
  els.infoMsg.textContent = msg;
  els.infoMsg.hidden = false;
  els.errorMsg.hidden = true;
  clearTimeout(showInfo._t);
  showInfo._t = setTimeout(() => { els.infoMsg.hidden = true; }, 4000);
}

function clearMessages() {
  els.errorMsg.hidden = true;
  els.infoMsg.hidden = true;
}

function setLoading(on, text = 'İşleniyor…') {
  els.loading.hidden = !on;
  if (on) els.loadingText.textContent = text;
}

function getTargetLangName() {
  const sel = els.targetLang;
  return sel.options[sel.selectedIndex]?.text || 'Türkçe';
}

/* ============================================================
   TESSERACT WORKER (cihaz üzeri OCR)
   ============================================================ */
async function initTesseract() {
  if (state.workerReady) return true;

  try {
    showInfo('OCR motoru yükleniyor… (ilk seferde birkaç saniye sürebilir)');
    const worker = await Tesseract.createWorker(CONFIG.OCR_LANGUAGES, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          els.loadingText.textContent = `Metin okunuyor… %${Math.round(m.progress * 100)}`;
        }
      }
    });
    state.tesseractWorker = worker;
    state.workerReady = true;
    showInfo('OCR motoru hazır ✅');
    return true;
  } catch (err) {
    console.error('[Tesseract]', err);
    showError('OCR motoru yüklenemedi. İnternet bağlantını kontrol et.');
    return false;
  }
}

/* ============================================================
   GÖRÜNTÜDEN OCR
   ============================================================ */
async function performOCR(imageSource) {
  if (!state.workerReady) {
    const ok = await initTesseract();
    if (!ok) return null;
  }

  setLoading(true, 'Görüntü işleniyor…');

  try {
    const { data } = await state.tesseractWorker.recognize(imageSource);
    const text = (data.text || '').trim();
    setLoading(false);
    return text;
  } catch (err) {
    console.error('[OCR]', err);
    setLoading(false);
    showError('Metin okunamadı. Farklı bir görsel dene.');
    return null;
  }
}

/* ============================================================
   ÇEVİRİ (MyMemory — ücretsiz, API key gerektirmez)
   ============================================================ */
async function translateText(text, targetLang) {
  if (!text || !text.trim()) {
    showError('Çevrilecek metin boş.');
    return null;
  }

  // MyMemory 500 byte sınırı — kısalt
  let query = text.trim();
  if (query.length > CONFIG.MAX_TEXT_LENGTH) {
    query = query.substring(0, CONFIG.MAX_TEXT_LENGTH);
  }

  // Kaynak dil otomatik: MyMemory "Autodetect" için boş bırakılabilir,
  // ancak güvenilirlik için "en" gibi yaygın bir dil vermek yerine
  // MyMemory'nin otomatik algılamasına güveniyoruz (langpair=Autodetect|hedef).
  // MyMemory "Autodetect" destekler mi? Evet, ancak bazen sorun çıkarabilir.
  // En güvenli yol: kaynak dili belirtmeden denemek. MyMemory API
  // langpair parametresinde kaynak dil boş bırakılamaz; bu yüzden
  // "Autodetect" yerine İngilizce varsayıp, eğer sonuç saçmaysa
  // kullanıcıya bilgi veririz. Aslında MyMemory "Autodetect" desteklemez.
  // Çözüm: Kaynak dili belirtmeden MyMemory'ye gönderemeyiz.
  // Bunun yerine "en" (İngilizce) varsayarak deneyelim; çoğu tabela
  // İngilizce olur. Daha iyisi: Tesseract zaten birden çok dilde
  // okuduğu için, kaynak dil tespiti için basit bir sezgisel
  // kullanabiliriz: Türkçe karakter varsa "tr", yoksa "en".
  // Ancak bu kullanıcı deneyimini bozar. MyMemory'nin "Autodetect"
  // desteği olmadığından, kaynak dili kullanıcıya sormak yerine
  // "en" varsayıp, eğer çeviri sonucu kaynakla aynıysa
  // kullanıcıya "Kaynak dil algılanamadı" uyarısı veririz.

  const sourceLang = detectSourceLang(query);
  const langpair = `${sourceLang}|${targetLang}`;

  const url = `${CONFIG.MYMEMORY_URL}?q=${encodeURIComponent(query)}&langpair=${langpair}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Çeviri servisi yanıt vermedi');
    const data = await res.json();

    if (data.responseStatus !== 200) {
      throw new Error(data.responseDetails || 'Çeviri başarısız');
    }

    let translated = data.responseData?.translatedText || '';

    // Eğer çeviri kaynakla aynıysa ve dil farklıysa, muhtemelen algılama yanlış
    if (translated.toLowerCase() === query.toLowerCase() && sourceLang !== targetLang) {
      // İkinci deneme: farklı kaynak dil ile
      const altSource = sourceLang === 'en' ? 'tr' : 'en';
      const altUrl = `${CONFIG.MYMEMORY_URL}?q=${encodeURIComponent(query)}&langpair=${altSource}|${targetLang}`;
      try {
        const altRes = await fetch(altUrl);
        const altData = await altRes.json();
        if (altData.responseStatus === 200 && altData.responseData?.translatedText) {
          translated = altData.responseData.translatedText;
        }
      } catch (e) { /* yoksay */ }
    }

    return translated;
  } catch (err) {
    console.error('[Çeviri]', err);
    showError('Çeviri yapılamadı. İnternet bağlantını kontrol et.');
    return null;
  }
}

/* Basit kaynak dil tespiti (Türkçe karakter sezgisi) */
function detectSourceLang(text) {
  const turkishChars = /[çğıöşüÇĞİÖŞÜ]/;
  if (turkishChars.test(text)) return 'tr';
  // Arapça
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  // Japonca (Hiragana/Katakana/Kanji)
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(text)) return 'ja';
  // Korece
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  // Rusça (Kiril)
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  // Varsayılan: İngilizce
  return 'en';
}

/* ============================================================
   SONUÇ GÖSTER
   ============================================================ */
function showResult(sourceText, translatedText) {
  els.sourceText.textContent = sourceText;
  els.translatedText.textContent = translatedText;
  els.resultLangName.textContent = getTargetLangName();
  els.resultSection.hidden = false;
  state.lastOcrText = sourceText;

  // Sonuca kaydır
  els.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ============================================================
   KAMERA
   ============================================================ */
async function startCamera() {
  clearMessages();

  if (!navigator.mediaDevices?.getUserMedia) {
    showError('Bu tarayıcı kamera erişimini desteklemiyor.');
    return;
  }

  setCameraStatus('Kamera başlatılıyor…');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

    state.stream = stream;
    els.video.srcObject = stream;
    await els.video.play().catch(() => {});

    els.video.addEventListener('loadedmetadata', () => {
      hideCameraStatus();
      els.startCameraBtn.disabled = true;
      els.captureBtn.disabled = false;
      els.stopCameraBtn.disabled = false;
      state.running = true;
    }, { once: true });

    if (els.video.readyState >= 2) {
      hideCameraStatus();
      els.startCameraBtn.disabled = true;
      els.captureBtn.disabled = false;
      els.stopCameraBtn.disabled = false;
      state.running = true;
    }

  } catch (err) {
    handleCameraError(err);
  }
}

function stopCamera() {
  state.running = false;
  els.startCameraBtn.disabled = false;
  els.captureBtn.disabled = true;
  els.stopCameraBtn.disabled = true;

  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (els.video) els.video.srcObject = null;

  setCameraStatus('Kamera kapalı');
}

function setCameraStatus(text, isError = false) {
  els.cameraStatus.textContent = text;
  els.cameraStatus.classList.remove('hidden');
  els.cameraStatus.classList.toggle('error', isError);
}

function hideCameraStatus() {
  els.cameraStatus.classList.add('hidden');
  els.cameraStatus.classList.remove('error');
}

function handleCameraError(err) {
  console.error('[Kamera]', err);
  let msg = 'Kamera başlatılamadı.';
  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
    msg = 'Kamera izni reddedildi. Tarayıcı ayarlarından izin ver.';
  } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
    msg = 'Cihazda kamera bulunamadı.';
  } else if (err.name === 'NotReadableError') {
    msg = 'Kamera başka bir uygulama tarafından kullanılıyor.';
  } else if (err.name === 'SecurityError') {
    msg = 'Kamera için HTTPS gerekli.';
  } else if (err.message) {
    msg = 'Kamera hatası: ' + err.message;
  }
  setCameraStatus(msg, true);
  showError(msg);
}

/* ============================================================
   FOTOĞRAF YAKALA → OCR → ÇEVİRİ
   ============================================================ */
async function captureAndTranslate() {
  if (state.processing) return;
  if (!state.running || els.video.readyState < 2) {
    showError('Kamera hazır değil.');
    return;
  }

  state.processing = true;
  els.captureBtn.disabled = true;
  clearMessages();

  const canvas = els.captureCanvas;
  canvas.width = els.video.videoWidth;
  canvas.height = els.video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(els.video, 0, 0);

  // OCR
  const ocrText = await performOCR(canvas);

  if (!ocrText || ocrText.length < 2) {
    showError('Metin okunamadı. Kamerayı metne daha yakın tut ve tekrar dene.');
    state.processing = false;
    els.captureBtn.disabled = false;
    return;
  }

  // Çeviri
  setLoading(true, 'Çeviri yapılıyor…');
  const targetLang = els.targetLang.value;
  const translated = await translateText(ocrText, targetLang);

  if (translated) {
    showResult(ocrText, translated);
  } else {
    // Çeviri başarısız olsa da OCR metnini göster
    showResult(ocrText, '(Çeviri yapılamadı)');
  }

  setLoading(false);
  state.processing = false;
  els.captureBtn.disabled = false;
}

/* ============================================================
   GALERİDEN YÜKLE → OCR → ÇEVİRİ
   ============================================================ */
async function handleGalleryImage(file) {
  if (state.processing) return;
  if (!file) return;

  state.processing = true;
  clearMessages();
  setLoading(true, 'Görsel yükleniyor…');

  try {
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    // Canvas'a çiz (büyük görselleri küçült)
    const canvas = els.captureCanvas;
    const maxDim = 1600;
    let w = img.width, h = img.height;
    if (w > maxDim || h > maxDim) {
      const ratio = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);

    // OCR
    const ocrText = await performOCR(canvas);

    if (!ocrText || ocrText.length < 2) {
      showError('Görselde metin bulunamadı veya okunamadı.');
      setLoading(false);
      state.processing = false;
      return;
    }

    // Çeviri
    setLoading(true, 'Çeviri yapılıyor…');
    const targetLang = els.targetLang.value;
    const translated = await translateText(ocrText, targetLang);

    if (translated) {
      showResult(ocrText, translated);
    } else {
      showResult(ocrText, '(Çeviri yapılamadı)');
    }

  } catch (err) {
    console.error('[Galeri]', err);
    showError('Görsel işlenemedi. Farklı bir görsel dene.');
  } finally {
    setLoading(false);
    state.processing = false;
  }
}

/* ============================================================
   KLAVYE İLE ÇEVİRİ
   ============================================================ */
async function handleManualTranslate(text) {
  if (state.processing || !text.trim()) return;

  state.processing = true;
  clearMessages();

  const targetLang = els.targetLang.value;

  setLoading(true, 'Çeviri yapılıyor…');
  const translated = await translateText(text, targetLang);

  if (translated) {
    showResult(text, translated);
  }

  setLoading(false);
  state.processing = false;
}

/* ============================================================
   KOPYALA
   ============================================================ */
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = old; }, 1500);
  } catch (e) {
    showError('Kopyalanamadı.');
  }
}

/* ============================================================
   OLAY DİNLEYİCİLERİ
   ============================================================ */
els.startCameraBtn.addEventListener('click', startCamera);
els.stopCameraBtn.addEventListener('click', stopCamera);
els.captureBtn.addEventListener('click', captureAndTranslate);

els.galleryInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleGalleryImage(file);
  e.target.value = '';
});

els.manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = els.manualInput.value.trim();
  if (!val) return;
  handleManualTranslate(val);
  els.manualInput.blur();
});

els.copySourceBtn.addEventListener('click', () => {
  if (state.lastOcrText) copyText(state.lastOcrText, els.copySourceBtn);
});

els.copyTranslatedBtn.addEventListener('click', () => {
  const t = els.translatedText.textContent;
  if (t) copyText(t, els.copyTranslatedBtn);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running) stopCamera();
});

/* ============================================================
   SERVICE WORKER
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        console.log('[SW] Kayıtlı:', reg.scope);
        els.swIndicator.classList.add('on');
      })
      .catch((err) => console.error('[SW] Hata:', err));
  });
}

window.addEventListener('offline', () => {
  showInfo('⚡ Çevrimdışısın. OCR çalışır ama çeviri için internet gerekir.');
});
window.addEventListener('online', () => clearMessages());

/* ============================================================
   BAŞLAT
   ============================================================ */
(async function init() {
  setCameraStatus('Kamera kapalı');
  // Tesseract'ı hemen yükleme — ilk kullanımda yüklenecek (pil dostu)
  console.log('[Kamera Çevirmeni] Hazır. Hedef dil:', els.targetLang.value);
})();