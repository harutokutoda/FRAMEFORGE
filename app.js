(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const dropEl   = $('drop');
  const imgInput = $('imgInput');
  const queueEl  = $('queue');
  const emptyEl  = $('empty');
  const countEl  = $('count');
  const goBtn    = $('go');
  const zipBtn   = $('zipBtn');
  const clearBtn = $('clearBtn');
  const fill     = $('fill');
  const logEl    = $('log');

  // Extension check is a fallback. The primary check uses file.type (MIME),
  // which correctly accepts HEIC/HEIF from iPhones, JXL, and anything else
  // the browser reports as an image.
  const IMG_RE = /\.(png|jpe?g|webp|bmp|avif|heic|heif|jxl|gif|tiff?)$/i;

  let items = [];          // { id, name, originalBlob, originalUrl, cutBlob, cutUrl, status, error }
  let busy = false;
  let lib = null;

  const log = m => { logEl.textContent = m; };
  const setProgress = p => { fill.style.width = Math.max(0, Math.min(1, p)) * 100 + '%'; };

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }

  function baseName(name) {
    return (name || 'image').replace(/\.[^.]+$/, '');
  }

  // Accept a file if the browser says it's an image, or if the name ends
  // with a known image extension. MIME wins when present.
  function isImage(file) {
    if (file.type && file.type.startsWith('image/')) return true;
    return IMG_RE.test(file.name);
  }

  /* ---------- library loading ---------- */
  async function loadLib() {
    if (lib) return lib;
    log('Loading background-removal model (first use downloads ~40 MB, cached after)…');
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
      lib = mod.default || mod.removeBackground || mod;
      if (typeof lib !== 'function') throw new Error('bad module shape');
      return lib;
    } catch (e) {
      log('ERROR: could not load the background-removal library. Check your connection.');
      throw e;
    }
  }

  /* ---------- queue rendering ---------- */
  function renderQueue() {
    queueEl.innerHTML = '';
    countEl.textContent = items.length;
    emptyEl.style.display = items.length ? 'none' : 'block';

    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'item';

      const originalThumb = document.createElement('div');
      originalThumb.className = 'thumb';
      const oImg = document.createElement('img');
      oImg.src = it.originalUrl;
      oImg.alt = 'original';
      const oTag = document.createElement('span');
      oTag.className = 'tag';
      oTag.textContent = 'Original';
      originalThumb.append(oImg, oTag);

      const cutThumb = document.createElement('div');
      cutThumb.className = 'thumb cut';
      if (it.cutUrl) {
        const cImg = document.createElement('img');
        cImg.src = it.cutUrl;
        cImg.alt = 'cutout';
        cutThumb.append(cImg);
      }
      const cTag = document.createElement('span');
      cTag.className = 'tag';
      cTag.textContent = 'Cutout';
      cutThumb.append(cTag);

      const status = document.createElement('div');
      status.className = 'status ' + it.status;
      status.textContent =
        it.status === 'queued'  ? 'Queued' :
        it.status === 'working' ? 'Working…' :
        it.status === 'done'    ? 'Done' :
        it.status === 'error'   ? ('Error: ' + (it.error || 'failed')) :
                                   it.status;

      const info = document.createElement('div');
      info.className = 'info';
      info.textContent = it.name;

      const dl = document.createElement('a');
      dl.className = 'dl-mini' + (it.status === 'done' ? '' : ' off');
      dl.textContent = '⬇ PNG';
      if (it.status === 'done') {
        dl.href = it.cutUrl;
        dl.download = baseName(it.name) + '-cutout.png';
      }

      row.append(originalThumb, cutThumb, status, info, dl);
      queueEl.append(row);
    }

    updateButtons();
  }

  function updateButtons() {
    const any = items.length > 0;
    const doneAny = items.some(i => i.status === 'done');
    goBtn.disabled = busy || !any;
    clearBtn.disabled = busy || !any;
    zipBtn.disabled = busy || !doneAny;
  }

  /* ---------- input handling ---------- */
  function addFiles(fileList) {
    // Snapshot to a real Array immediately. The FileList returned by
    // input.files is LIVE and empties the moment input.value is reset.
    const files = Array.from(fileList || []);

    if (!files.length) {
      log('No files were selected.');
      return;
    }

    let added = 0;
    const skipped = [];

    for (const f of files) {
      if (!isImage(f)) { skipped.push(f.name); continue; }

      const id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random());
      items.push({
        id,
        name: f.name || ('image-' + id.slice(0, 6)),
        originalBlob: f,
        originalUrl: URL.createObjectURL(f),
        cutBlob: null,
        cutUrl: null,
        status: 'queued',
        error: null
      });
      added++;
    }

    if (added) {
      log('Added ' + added + ' image' + (added > 1 ? 's' : '') + '.' +
          (skipped.length ? ' Skipped ' + skipped.length + ' unsupported file(s).' : ''));
      renderQueue();
    } else {
      log('No supported image files were added. ' +
          files.length + ' file(s) seen: ' +
          files.slice(0, 6).map(f => f.name).join(', ') +
          (files.length > 6 ? ', …' : ''));
    }
  }

  imgInput.addEventListener('change', () => {
    const files = Array.from(imgInput.files || []);   // snapshot FIRST
    imgInput.value = '';                              // then reset (safe now)
    if (busy || !files.length) return;
    addFiles(files);
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
  dropEl.addEventListener('drop', e => {
    if (busy) return;
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) addFiles(files);
  });

  dropEl.addEventListener('click', e => {
    if (e.target.closest('label, input, button')) return;
    if (busy) return;
    imgInput.click();
  });

  /* ---------- processing ---------- */
  async function run() {
    if (busy || !items.length) return;

    let removeBackground;
    try {
      removeBackground = await loadLib();
    } catch (e) {
      return;
    }

    busy = true;
    updateButtons();
    dropEl.classList.add('locked');

    const targets = items.filter(i => i.status !== 'done');
    if (!targets.length) {
      log('All images already processed.');
      busy = false;
      updateButtons();
      dropEl.classList.remove('locked');
      return;
    }

    let doneCount = 0;
    const startTs = performance.now();

    for (let idx = 0; idx < targets.length; idx++) {
      const it = targets[idx];
      it.status = 'working';
      it.error = null;
      renderQueue();

      log('Processing ' + (idx + 1) + ' / ' + targets.length + ' — ' + it.name);

      try {
        const resultBlob = await removeBackground(it.originalBlob, {
          progress: (key, current, total) => {
            if (typeof total === 'number' && total > 0) {
              const inner = current / total;
              log('Downloading model… ' + Math.round(inner * 100) + '% (' + key + ')');
            }
          }
        });

        if (it.cutUrl) URL.revokeObjectURL(it.cutUrl);
        it.cutBlob = resultBlob;
        it.cutUrl = URL.createObjectURL(resultBlob);
        it.status = 'done';
      } catch (e) {
        it.status = 'error';
        it.error = (e && e.message) ? e.message.slice(0, 60) : 'failed';
        log('Error on ' + it.name + ': ' + it.error);
      }

      doneCount++;
      setProgress(doneCount / targets.length);
      renderQueue();

      const elapsed = (performance.now() - startTs) / 1000;
      const rate = elapsed / doneCount;
      const remain = rate * (targets.length - doneCount);
      if (remain > 1) {
        log('Done ' + doneCount + ' / ' + targets.length + ' — ~' +
            Math.ceil(remain) + ' s remaining');
      }
    }

    setProgress(1);
    const okCount = targets.filter(i => i.status === 'done').length;
    log('Finished. ' + okCount + ' / ' + targets.length + ' processed successfully.');

    busy = false;
    dropEl.classList.remove('locked');
    updateButtons();
  }

  /* ---------- ZIP download ---------- */
  async function downloadZip() {
    if (busy) return;
    const done = items.filter(i => i.status === 'done' && i.cutBlob);
    if (!done.length) return;
    if (typeof JSZip === 'undefined') {
      log('ERROR: ZIP library failed to load.');
      return;
    }

    busy = true;
    updateButtons();
    log('Building ZIP…');

    try {
      const zip = new JSZip();
      const used = new Set();
      for (const it of done) {
        let name = baseName(it.name) + '-cutout.png';
        let n = 1;
        while (used.has(name)) {
          name = baseName(it.name) + '-cutout-' + (n++) + '.png';
        }
        used.add(name);
        zip.file(name, it.cutBlob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'frameforge-cutouts.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      log('ZIP ready — ' + formatBytes(blob.size) + ' (' + done.length + ' images).');
    } catch (e) {
      log('ERROR building ZIP: ' + (e.message || e));
    }

    busy = false;
    updateButtons();
  }

  /* ---------- clear ---------- */
  function clearAll() {
    if (busy) return;
    for (const it of items) {
      if (it.originalUrl) URL.revokeObjectURL(it.originalUrl);
      if (it.cutUrl) URL.revokeObjectURL(it.cutUrl);
    }
    items = [];
    setProgress(0);
    log('Cleared.');
    renderQueue();
  }

  /* ---------- wiring ---------- */
  goBtn.addEventListener('click', run);
  zipBtn.addEventListener('click', downloadZip);
  clearBtn.addEventListener('click', clearAll);

  /* ---------- init ---------- */
  renderQueue();
  log('Ready. Add images to get started.');
})();