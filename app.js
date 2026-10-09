(function () {
  'use strict';

  /* ---------- element refs ---------- */
  const $ = id => document.getElementById(id);
  const dropEl      = $('drop');
  const zipInput    = $('zipInput');
  const imgInput    = $('imgInput');
  const secInput    = $('sec');
  const fpsInput    = $('fps');
  const presetSel   = $('preset');
  const widthInput  = $('width');
  const heightInput = $('height');
  const fitSel      = $('fit');
  const bgInput     = $('bg');
  const bitrateIn   = $('bitrate');
  const brLabel     = $('brLabel');
  const estimateEl  = $('estimate');
  const goBtn       = $('go');
  const cancelBtn   = $('cancel');
  const logEl       = $('log');
  const fill        = $('fill');
  const resultEl    = $('result');
  const preview     = $('preview');
  const dlLink      = $('download');

  /* ---------- constants & state ---------- */
  const IMG_RE    = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
  const MAX_CACHE = 12;

  let rawList       = [];
  let items         = [];
  let firstImageDim = null;
  let busy          = false;
  let cancelRequested = false;
  let lastUrl       = null;
  let baseName      = 'video';

  let decodeCache   = new Map();
  let decodePending = new Map();
  let cacheGen      = 0;

  /* ---------- helpers ---------- */
  const log = m => { logEl.textContent = m; };
  const setProgress = p => { fill.style.width = Math.max(0, Math.min(1, p)) * 100 + '%'; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const naturalCompare = (a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }

  /* ---------- decoding (EXIF orientation aware) ---------- */
  async function decodeImage(blob) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch (e) {}
      try { return await createImageBitmap(blob); } catch (e) {}
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  async function getBlob(item) {
    if (item.file) return item.file;
    return await item.entry.async('blob');
  }

  function closeImage(img) {
    if (img && typeof img.close === 'function') { try { img.close(); } catch (e) {} }
  }

  function resetCache() {
    cacheGen++;
    for (const img of decodeCache.values()) closeImage(img);
    decodeCache.clear();
    decodePending.clear();
  }

  function evictCache() {
    while (decodeCache.size > MAX_CACHE) {
      const k = decodeCache.keys().next().value;
      closeImage(decodeCache.get(k));
      decodeCache.delete(k);
    }
  }

  function getOrStartDecode(i) {
    if (decodeCache.has(i)) return Promise.resolve(decodeCache.get(i));
    if (decodePending.has(i)) return decodePending.get(i);

    const gen = cacheGen;
    const p = getBlob(items[i])
      .then(decodeImage)
      .then(img => {
        if (gen !== cacheGen) { closeImage(img); throw new Error('stale'); }
        decodeCache.set(i, img);
        evictCache();
        decodePending.delete(i);
        return img;
      })
      .catch(err => {
        if (gen === cacheGen) decodePending.delete(i);
        throw err;
      });

    decodePending.set(i, p);
    return p;
  }

  async function getImage(i) {
    const img = await getOrStartDecode(i);
    if (decodeCache.has(i)) {
      decodeCache.delete(i);
      decodeCache.set(i, img);
    }
    return img;
  }

  function prefetch(around) {
    for (let k = 1; k <= 3; k++) {
      const j = around + k;
      if (j < items.length) getOrStartDecode(j).catch(() => {});
    }
  }

  /* ---------- ordering & probing ---------- */
  function applyOrder() {
    const mode = document.querySelector('input[name="order"]:checked').value;
    items = (mode === 'name')
      ? rawList.slice().sort((a, b) => naturalCompare(a.name, b.name))
      : rawList.slice();
    resetCache();
  }

  async function probeFirst() {
    firstImageDim = null;
    if (!items.length) { updateSizeInputs(); updateEstimate(); return; }
    try {
      const blob = await getBlob(items[0]);
      const img  = await decodeImage(blob);
      firstImageDim = { w: img.width, h: img.height };
      closeImage(img);
    } catch (e) {
      log('Could not decode the first image.');
    }
    updateSizeInputs();
    updateEstimate();
  }

  /* ---------- size / settings ---------- */
  function computeOutputSize() {
    const preset = presetSel.value;
    const fw = firstImageDim ? firstImageDim.w : 1280;
    const fh = firstImageDim ? firstImageDim.h : 720;

    let w, h;
    if (preset === 'auto') {
      w = clamp(parseInt(widthInput.value, 10) || 1280, 64, 3840);
      h = Math.round(w * fh / fw);
    } else if (preset === 'custom') {
      w = clamp(parseInt(widthInput.value, 10) || 1280, 64, 3840);
      h = clamp(parseInt(heightInput.value, 10) || 720, 64, 3840);
    } else {
      const p = preset.split('x');
      w = parseInt(p[0], 10);
      h = parseInt(p[1], 10);
    }
    w = Math.max(2, w - (w % 2));
    h = Math.max(2, h - (h % 2));
    return { w, h };
  }

  function updateSizeInputs() {
    const p = presetSel.value;
    if (p === 'auto') {
      widthInput.disabled = false;
      heightInput.disabled = true;
      const { w, h } = computeOutputSize();
      widthInput.value = w;
      heightInput.value = h;
    } else if (p === 'custom') {
      widthInput.disabled = false;
      heightInput.disabled = false;
    } else {
      widthInput.disabled = true;
      heightInput.disabled = true;
      const { w, h } = computeOutputSize();
      widthInput.value = w;
      heightInput.value = h;
    }
  }

  function updateEstimate() {
    if (!items.length) {
      estimateEl.textContent = 'Load some images to see an estimate.';
      goBtn.disabled = true;
      return;
    }

    const fps    = clamp(parseInt(fpsInput.value, 10) || 30, 1, 60);
    const secPer = Math.max(0.05, parseFloat(secInput.value) || 1);
    const { w, h } = computeOutputSize();
    const mbps   = clamp(parseInt(bitrateIn.value, 10) || 8, 1, 30);

    const duration = items.length * secPer;
    const frames   = Math.round(duration * fps);
    const estBytes = (duration * mbps / 8) * 1048576;

    let html = '';
    html += `Images: <b>${items.length}</b> &nbsp;·&nbsp; `;
    html += `Duration: <b>${duration.toFixed(1)} s</b> &nbsp;·&nbsp; `;
    html += `Frames: <b>${frames}</b> &nbsp;·&nbsp; `;
    html += `Output: <b>${w} × ${h}</b><br>`;
    html += `Estimated file size: <b>~${formatBytes(estBytes)}</b> at ${mbps} Mbps<br>`;

    const warns = [];
    if (items.length > 500)
      warns.push(`${items.length} images — rendering will take a while.`);
    if (firstImageDim) {
      const mp = (firstImageDim.w * firstImageDim.h) / 1e6;
      if (mp > 30) warns.push(`First image is ${mp.toFixed(1)} MP — decoding may be slow and memory-heavy.`);
    }
    if (w * h > 3840 * 2160)
      warns.push(`Output is larger than 4K (${w}×${h}) — encoding may be very slow.`);
    if (warns.length) html += '<span class="warn">⚠ ' + warns.join('<br>⚠ ') + '</span>';

    estimateEl.innerHTML = html;
    goBtn.disabled = busy || !firstImageDim;
  }

  function setBusyUI(isBusy) {
    document.querySelectorAll('fieldset').forEach(fs => {
      if (fs.contains(goBtn)) return;
      fs.classList.toggle('locked', isBusy);
    });
    dropEl.classList.toggle('locked', isBusy);
  }

  /* ---------- drawing ---------- */
  function drawFit(ctx, img, W, H, mode) {
    const iw = img.width, ih = img.height;
    if (mode === 'stretch') { ctx.drawImage(img, 0, 0, W, H); return; }
    const scale = (mode === 'cover') ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  /* ---------- loading ---------- */
  function resetState() {
    resetCache();
    rawList = [];
    items = [];
    firstImageDim = null;
    setProgress(0);
    resultEl.classList.add('hidden');
    if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
    preview.removeAttribute('src');
    dlLink.removeAttribute('href');
    updateEstimate();
  }

  async function loadZipFile(file) {
    if (typeof JSZip === 'undefined') { log('ERROR: JSZip failed to load.'); return; }
    log('Reading ' + file.name + '…');
    let zip;
    try { zip = await JSZip.loadAsync(file); }
    catch (e) { log('ERROR: could not read zip — ' + e.message); return; }

    const list = [];
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      const name = path.split('/').pop();
      if (!name || name.charAt(0) === '.') return;
      if (!IMG_RE.test(name)) return;
      list.push({ name, entry });
    });

    if (!list.length) { log('No image files found in that zip.'); return; }

    baseName = file.name.replace(/\.zip$/i, '') || 'video';
    rawList = list;
    applyOrder();
    log('Found ' + rawList.length + ' images. Probing first…');
    await probeFirst();
    log('Ready: ' + items.length + ' images. First → ' + (items[0] ? items[0].name : ''));
  }

  function loadImageFiles(fileList) {
    const list = [];
    for (const f of fileList) {
      if (!IMG_RE.test(f.name)) continue;
      list.push({ name: f.name, file: f });
    }
    if (!list.length) { log('No image files selected.'); return; }
    baseName = 'video';
    rawList = list;
    applyOrder();
    log('Loaded ' + rawList.length + ' images. Probing first…');
    probeFirst().then(() =>
      log('Ready: ' + items.length + ' images. First → ' + (items[0] ? items[0].name : ''))
    );
  }

  /* ---------- render (WebCodecs, frame-accurate) ---------- */
  async function render() {
    if (busy || !items.length || !firstImageDim) return;
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
      log('ERROR: this browser lacks WebCodecs. Use Chrome, Edge, or a recent Firefox/Safari.');
      return;
    }

    busy = true;
    cancelRequested = false;
    goBtn.disabled = true;
    cancelBtn.disabled = false;
    setBusyUI(true);
    resultEl.classList.add('hidden');
    if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
    setProgress(0);

    const fps    = clamp(parseInt(fpsInput.value, 10) || 30, 1, 60);
    const secPer = Math.max(0.05, parseFloat(secInput.value) || 1);
    const { w: outW, h: outH } = computeOutputSize();
    const mbps   = clamp(parseInt(bitrateIn.value, 10) || 8, 1, 30);
    const bitrate = mbps * 1000000;
    const fit    = fitSel.value;
    const bg     = bgInput.value;

    const framesPerImage = Math.max(1, Math.round(secPer * fps));
    const totalFrames    = items.length * framesPerImage;

    const canvas = document.createElement('canvas');
    canvas.width  = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { alpha: false });

    log('Loading muxer…');
    let muxerMod;
    try {
      muxerMod = await import('https://cdn.jsdelivr.net/npm/webm-muxer@5.1.0/+esm');
    } catch (e) {
      log('ERROR: could not load the muxer library (check your connection).');
      busy = false; goBtn.disabled = false; cancelBtn.disabled = true; setBusyUI(false);
      return;
    }
    const { Muxer, ArrayBufferTarget } = muxerMod;

    const codecOptions = [
      { webcodec: 'vp09.00.10.08', muxer: 'V_VP9', ext: 'webm', label: 'VP9' },
      { webcodec: 'vp09.00.31.08', muxer: 'V_VP9', ext: 'webm', label: 'VP9' },
      { webcodec: 'vp8',           muxer: 'V_VP8', ext: 'webm', label: 'VP8' }
    ];
    let chosen = null;
    for (const o of codecOptions) {
      try {
        const sup = await VideoEncoder.isConfigSupported({
          codec: o.webcodec, width: outW, height: outH, bitrate, framerate: fps
        });
        if (sup && sup.supported) { chosen = o; break; }
      } catch (e) {}
    }
    if (!chosen) {
      log('ERROR: no supported video codec for ' + outW + '×' + outH + '.');
      busy = false; goBtn.disabled = false; cancelBtn.disabled = true; setBusyUI(false);
      return;
    }

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: chosen.muxer, width: outW, height: outH, frameRate: fps }
    });

    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try { muxer.addVideoChunk(chunk, meta); }
        catch (e) { encoderError = e; }
      },
      error: e => { encoderError = e; }
    });
    encoder.configure({
      codec: chosen.webcodec,
      width: outW,
      height: outH,
      bitrate,
      framerate: fps,
      latencyMode: 'quality'
    });

    log(`Rendering ${totalFrames} frames @ ${fps} fps → ${outW}×${outH} (${chosen.label})…`);

    const frameDuration = Math.round(1e6 / fps);
    const startTs = performance.now();
    let cancelled = false;

    try {
      for (let i = 0; i < totalFrames; i++) {
        if (cancelRequested) { cancelled = true; break; }
        if (encoderError) throw encoderError;

        const imgIdx = Math.min(items.length - 1, Math.floor(i / framesPerImage));
        const img = await getImage(imgIdx);

        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, outW, outH);
        drawFit(ctx, img, outW, outH, fit);

        const frame = new VideoFrame(canvas, {
          timestamp: i * frameDuration,
          duration: frameDuration
        });
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();

        if (encoder.encodeQueueSize > 8) {
          while (encoder.encodeQueueSize > 4 && !cancelRequested && !encoderError) {
            await sleep(4);
          }
        }

        if (i % framesPerImage === 0) prefetch(imgIdx);

        if (i % 3 === 0 || i === totalFrames - 1) {
          const p = (i + 1) / totalFrames;
          setProgress(p);
          const elapsed = (performance.now() - startTs) / 1000;
          const eta = p > 0.02 ? Math.max(0, elapsed / p - elapsed) : 0;
          log(`Frame ${i + 1} / ${totalFrames}  (${Math.round(p * 100)}%)` +
              (eta > 1 ? `  ·  ~${Math.ceil(eta)} s left` : ''));
        }
      }

      if (!cancelled) {
        log('Flushing encoder…');
        await encoder.flush();
      }
    } catch (e) {
      log('ERROR during render: ' + (e && e.message ? e.message : e));
      cancelled = true;
    }

    try { encoder.close(); } catch (e) {}

    if (cancelled) {
      log(cancelRequested ? 'Cancelled.' : 'Render failed.');
      busy = false;
      goBtn.disabled = false;
      cancelBtn.disabled = true;
      setBusyUI(false);
      updateEstimate();
      return;
    }

    muxer.finalize();
    const buffer = muxer.target.buffer;
    const blob = new Blob([buffer], { type: 'video/webm' });
    lastUrl = URL.createObjectURL(blob);

    preview.src = lastUrl;
    dlLink.href = lastUrl;
    dlLink.download = baseName + '.' + chosen.ext;
    dlLink.textContent = '⬇ Download ' + baseName + '.' + chosen.ext +
                         '  (' + formatBytes(blob.size) + ')';
    resultEl.classList.remove('hidden');

    setProgress(1);
    log('Done — ' + formatBytes(blob.size) + ' (' + totalFrames + ' frames).');

    busy = false;
    goBtn.disabled = false;
    cancelBtn.disabled = true;
    setBusyUI(false);
    updateEstimate();
  }

  /* ---------- wiring ---------- */

  // Drop zone: tapping the empty area opens the ZIP picker.
  // The labels and inputs handle their own clicks, so we skip those.
  dropEl.addEventListener('click', e => {
    if (e.target.closest('label, input, button')) return;
    if (busy) return;
    zipInput.click();
  });

  zipInput.addEventListener('change', async () => {
    const f = zipInput.files && zipInput.files[0];
    zipInput.value = '';
    if (!f || busy) return;
    resetState();
    await loadZipFile(f);
  });

  imgInput.addEventListener('change', () => {
    const files = imgInput.files;
    imgInput.value = '';
    if (!files || !files.length || busy) return;
    resetState();
    loadImageFiles(files);
  });

  ['dragenter', 'dragover'].forEach(ev =>
    dropEl.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      if (!busy) dropEl.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    dropEl.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      dropEl.classList.remove('over');
    })
  );
  dropEl.addEventListener('drop', async e => {
    if (busy) return;
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;

    const zipFile = Array.from(files).find(f => /\.zip$/i.test(f.name));
    resetState();
    if (zipFile) await loadZipFile(zipFile);
    else         loadImageFiles(files);
  });

  presetSel.addEventListener('change', () => { updateSizeInputs(); updateEstimate(); });
  widthInput.addEventListener('input', () => {
    if (presetSel.value === 'auto') updateSizeInputs();
    updateEstimate();
  });
  heightInput.addEventListener('input', updateEstimate);
  secInput.addEventListener('input', updateEstimate);
  fpsInput.addEventListener('input', updateEstimate);
  fitSel.addEventListener('change', updateEstimate);
  bgInput.addEventListener('input', updateEstimate);
  bitrateIn.addEventListener('input', () => {
    brLabel.textContent = bitrateIn.value;
    updateEstimate();
  });

  document.querySelectorAll('input[name="order"]').forEach(r =>
    r.addEventListener('change', async () => {
      if (busy) return;
      applyOrder();
      await probeFirst();
    })
  );

  goBtn.addEventListener('click', render);
  cancelBtn.addEventListener('click', () => {
    if (!busy) return;
    cancelRequested = true;
    cancelBtn.disabled = true;
    log('Cancelling…');
  });

  /* ---------- init ---------- */
  updateSizeInputs();
  updateEstimate();
})();

