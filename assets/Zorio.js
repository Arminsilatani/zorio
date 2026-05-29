/*
  ****************************************************
  *  Author: Armin Silatani
  *  Date: 2026-05-29
  *  Version: 0.2.0
  ****************************************************
*/

/* =========================== ZORIO IMAGE CONVERTER ============================ */

/* ------------------------- DOM ELEMENTS ------------------------- */
const fileInput          = document.getElementById('fileInput');
const selectFileBtn      = document.getElementById('selectFileBtn');
const uploadArea         = document.getElementById('uploadArea');
const fileListDiv        = document.getElementById('fileList');
const clearQueueBtn      = document.getElementById('clearQueueBtn');
const noImageMsg         = document.getElementById('noImageMsg');
const outputFormatSelect = document.getElementById('outputFormat');
const qualitySlider      = document.getElementById('qualitySlider');
const qualityValSpan     = document.getElementById('qualityVal');
const qualityGroup       = document.getElementById('qualityGroup');
const maxWidthInput      = document.getElementById('maxWidth');
const maxHeightInput     = document.getElementById('maxHeight');
const convertBtn         = document.getElementById('convertBtn');
const resultArea         = document.getElementById('resultArea');
const resultsListDiv     = document.getElementById('resultsList');
const downloadAllBtn     = document.getElementById('downloadAllBtn');
const errorMsgDiv        = document.getElementById('errorMsg');
const avifNotice         = document.getElementById('avifNotice');

/* ------------------------- STATE ------------------------- */
let uploadedImages = [];  // { id, file, imgElement, width, height, objectURL }
let results        = [];  // { id, blob, outputURL, name, sizeKB, originalName, ... }
let counter        = 0;

/* AVIF encoder module – loaded lazily on first AVIF conversion */
let avifEncodeModule = null;

/* ------------------------- UTILITIES ------------------------- */

/** Display an error message that auto-hides after 5 seconds */
function showError(msg) {
    errorMsgDiv.style.display = 'block';
    errorMsgDiv.innerText = msg;
    setTimeout(() => { errorMsgDiv.style.display = 'none'; }, 5000);
}

/** Revoke all object URLs for uploaded images and clear the array */
function revokeAllImageURLs() {
    uploadedImages.forEach(img => {
        if (img.objectURL) URL.revokeObjectURL(img.objectURL);
    });
    uploadedImages = [];
}

/** Revoke all object URLs for conversion results and clear the array */
function revokeResultURLs() {
    results.forEach(r => {
        if (r.outputURL) URL.revokeObjectURL(r.outputURL);
    });
    results = [];
}

/**
 * Disable quality slider for formats that don't use it (PNG, TIFF, ICO).
 * Show AVIF CDN notice when AVIF is selected.
 */
function toggleQualityControl() {
    const fmt = outputFormatSelect.value;
    const noQuality = ['image/png', 'image/tiff', 'image/x-icon'].includes(fmt);
    qualitySlider.disabled = noQuality;
    qualityGroup.style.opacity = noQuality ? '0.6' : '1';
    avifNotice.style.display = (fmt === 'image/avif') ? 'block' : 'none';
}

/** Update the quality slider’s visual fill and displayed percentage */
function updateQualitySlider() {
    const percent = Math.round(qualitySlider.value * 100);
    qualityValSpan.innerText = `${percent}%`;
    qualitySlider.style.background =
        `linear-gradient(90deg, #FD7E14 ${percent}%, #1e1e2a ${percent}%)`;
}

/**
 * Calculate new dimensions based on max width/height constraints.
 * Returns { width, height, resized } – resized is true if a change was made.
 */
function calcNewDimensions(imgW, imgH, maxW, maxH) {
    let targetW = imgW,
        targetH = imgH,
        resized = false;

    if (maxW && maxH && maxW > 0 && maxH > 0) {
        const scale = Math.min(maxW / imgW, maxH / imgH);
        if (scale < 1) {
            targetW = Math.floor(imgW * scale);
            targetH = Math.floor(imgH * scale);
            resized = true;
        }
    } else if (maxW && maxW > 0 && maxW < imgW) {
        targetW = maxW;
        targetH = Math.floor(imgH * (maxW / imgW));
        resized = true;
    } else if (maxH && maxH > 0 && maxH < imgH) {
        targetH = maxH;
        targetW = Math.floor(imgW * (maxH / imgH));
        resized = true;
    }

    return {
        width: Math.max(1, targetW),
        height: Math.max(1, targetH),
        resized
    };
}

/**
 * Draw an image onto a canvas and extract ImageData.
 * Returns { canvas, ctx, imageData }.
 */
function getImageData(imgElement, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0, width, height);
    return {
        canvas,
        ctx,
        imageData: ctx.getImageData(0, 0, width, height)
    };
}

/* ------------------------- FORMAT ENCODERS ------------------------- */

/**
 * Standard canvas-based encode: JPEG, PNG, WebP.
 */
function encodeViaCanvas(imgElement, width, height, mime, quality) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // JPEG requires a white background to avoid transparency artefacts
        if (mime === 'image/jpeg') {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
        }

        ctx.drawImage(imgElement, 0, 0, width, height);

        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null')),
            mime,
            quality
        );
    });
}

/**
 * TIFF encode using UTIF.js.
 * UTIF.encodeImage expects a Uint8Array of raw RGBA pixels.
 */
function encodeTiff(imgElement, width, height) {
    if (typeof UTIF === 'undefined') {
        return Promise.reject(new Error('UTIF.js not loaded. Make sure assets/libs/UTIF.js exists.'));
    }

    const { imageData } = getImageData(imgElement, width, height);
    const tiffBuffer = UTIF.encodeImage(imageData.data, width, height);
    return Promise.resolve(new Blob([tiffBuffer], { type: 'image/tiff' }));
}

/**
 * AVIF encode using @jsquash/avif (loaded from jsDelivr CDN).
 * Module is imported once and cached in avifEncodeModule.
 */
async function encodeAvif(imgElement, width, height, quality) {
    if (!avifEncodeModule) {
        try {
            avifEncodeModule = await import(
                'https://cdn.jsdelivr.net/npm/@jsquash/avif@1.3.0/encode.js'
            );
            // The module needs to initialise its WASM binary.
            // @jsquash/avif auto-fetches the .wasm from the same CDN path.
            if (typeof avifEncodeModule.default === 'function') {
                await avifEncodeModule.default();
            }
        } catch (err) {
            throw new Error(`Failed to load AVIF encoder from CDN: ${err.message}`);
        }
    }

    const { imageData } = getImageData(imgElement, width, height);

    // quality is 0–100 for @jsquash/avif
    const avifQuality = Math.round(quality * 100);
    const avifBuffer = await avifEncodeModule.encode(imageData, {
        quality: avifQuality,
        qualityAlpha: avifQuality,
        speed: 6  // 0 (slowest/best) – 10 (fastest/worst); 6 is a good default
    });

    return new Blob([avifBuffer], { type: 'image/avif' });
}

/**
 * ICO encode – pure JS, no library needed.
 *
 * Builds a multi-size ICO file containing 16×16, 32×32, and 48×48 bitmaps.
 * ICO format reference: https://en.wikipedia.org/wiki/ICO_(file_format)
 *
 * Structure:
 *   ICONDIR  (6 bytes)
 *   ICONDIRENTRY × n  (16 bytes each)
 *   BMP/PNG data for each size
 *
 * We embed each size as a 32-bit ARGB BMP (BITMAPINFOHEADER + XOR mask).
 */
function encodeIco(imgElement) {
    const sizes = [16, 32, 48];

    // Build raw RGBA pixel data for each size
    const frames = sizes.map(size => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgElement, 0, 0, size, size);
        return { size, data: ctx.getImageData(0, 0, size, size).data };
    });

    // Each BMP frame: BITMAPINFOHEADER (40 bytes) + pixel data (BGRA, bottom-up) + AND mask
    const bmpFrames = frames.map(({ size, data }) => {
        const pixelCount = size * size;
        const rowBytes = size * 4;                    // 4 bytes per pixel (BGRA)
        const andMaskRowBytes = Math.ceil(size / 8) * 4; // padded to 4-byte boundary
        const andMaskSize = andMaskRowBytes * size;
        const bmpSize = 40 + pixelCount * 4 + andMaskSize;
        const buf = new ArrayBuffer(bmpSize);
        const view = new DataView(buf);

        // BITMAPINFOHEADER
        view.setUint32(0, 40, true);              // biSize
        view.setInt32(4, size, true);             // biWidth
        view.setInt32(8, size * 2, true);         // biHeight (×2 for XOR+AND masks)
        view.setUint16(12, 1, true);              // biPlanes
        view.setUint16(14, 32, true);             // biBitCount
        view.setUint32(16, 0, true);              // biCompression (BI_RGB)
        view.setUint32(20, pixelCount * 4, true); // biSizeImage
        view.setUint32(24, 0, true);              // biXPelsPerMeter
        view.setUint32(28, 0, true);              // biYPelsPerMeter
        view.setUint32(32, 0, true);              // biClrUsed
        view.setUint32(36, 0, true);              // biClrImportant

        // Pixel data – BMP is bottom-up, ICO uses BGRA
        let offset = 40;
        for (let row = size - 1; row >= 0; row--) {
            for (let col = 0; col < size; col++) {
                const i = (row * size + col) * 4;
                view.setUint8(offset++, data[i + 2]); // B
                view.setUint8(offset++, data[i + 1]); // G
                view.setUint8(offset++, data[i + 0]); // R
                view.setUint8(offset++, data[i + 3]); // A
            }
        }

        // AND mask – all zeros (fully opaque; alpha channel handles transparency)
        // offset already points past pixel data; just leave zeros (ArrayBuffer is zero-init)

        return new Uint8Array(buf);
    });

    // ICONDIR header: reserved(2) + type(2) + count(2)
    const numImages = bmpFrames.length;
    const headerSize = 6 + numImages * 16;
    let dataOffset = headerSize;

    // Calculate total buffer size
    const totalSize = headerSize + bmpFrames.reduce((sum, f) => sum + f.byteLength, 0);
    const icoBuffer = new ArrayBuffer(totalSize);
    const icoView = new DataView(icoBuffer);
    const icoBytes = new Uint8Array(icoBuffer);

    // ICONDIR
    icoView.setUint16(0, 0, true);          // reserved
    icoView.setUint16(2, 1, true);          // type: 1 = ICO
    icoView.setUint16(4, numImages, true);  // count

    // ICONDIRENTRY for each frame
    bmpFrames.forEach((frame, i) => {
        const size = sizes[i];
        const entryOffset = 6 + i * 16;
        icoView.setUint8(entryOffset + 0, size === 256 ? 0 : size); // width  (0 = 256)
        icoView.setUint8(entryOffset + 1, size === 256 ? 0 : size); // height (0 = 256)
        icoView.setUint8(entryOffset + 2, 0);    // color count (0 = no palette)
        icoView.setUint8(entryOffset + 3, 0);    // reserved
        icoView.setUint16(entryOffset + 4, 1, true);  // planes
        icoView.setUint16(entryOffset + 6, 32, true); // bit count
        icoView.setUint32(entryOffset + 8, frame.byteLength, true); // size of image data
        icoView.setUint32(entryOffset + 12, dataOffset, true);       // offset of image data

        // Copy BMP data into ICO buffer
        icoBytes.set(frame, dataOffset);
        dataOffset += frame.byteLength;
    });

    return Promise.resolve(new Blob([icoBuffer], { type: 'image/x-icon' }));
}

/* ------------------------- IMAGE LOADING ------------------------- */

/**
 * Load a regular image file via object URL → HTMLImageElement.
 */
function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const objectURL = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve({
            imgElement: img,
            width: img.width,
            height: img.height,
            objectURL
        });
        img.onerror = () => {
            URL.revokeObjectURL(objectURL);
            reject(new Error('Failed to load image.'));
        };
        img.src = objectURL;
    });
}

/**
 * Load a TIFF file using UTIF.js → HTMLImageElement via canvas.
 */
async function loadTiff(file) {
    if (typeof UTIF === 'undefined') {
        throw new Error('UTIF.js not loaded. Make sure assets/libs/UTIF.js exists.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const ifds = UTIF.decode(arrayBuffer);
    if (!ifds || ifds.length === 0) throw new Error('Could not decode TIFF file.');

    // Decode first page
    UTIF.decodeImage(arrayBuffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const width = ifds[0].width;
    const height = ifds[0].height;

    // Paint onto canvas → get object URL
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) return reject(new Error('Failed to create preview from TIFF.'));
            const objectURL = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => resolve({ imgElement: img, width, height, objectURL });
            img.onerror = () => {
                URL.revokeObjectURL(objectURL);
                reject(new Error('Failed to load TIFF preview.'));
            };
            img.src = objectURL;
        }, 'image/png');
    });
}

/**
 * Load a HEIC/HEIF file using heic2any → HTMLImageElement.
 */
async function loadHeic(file) {
    if (typeof heic2any === 'undefined') {
        throw new Error('heic2any not loaded. Make sure assets/libs/heic2any.min.js exists.');
    }
    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const outputBlob = Array.isArray(blob) ? blob[0] : blob;
    return loadImageFromFile(outputBlob);
}

/**
 * Unified loader – picks the right strategy based on file type.
 */
async function loadAnyImage(file) {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();

    if (type === 'image/tiff' || name.endsWith('.tif') || name.endsWith('.tiff')) {
        return loadTiff(file);
    }
    if (type === 'image/heic' || type === 'image/heif' ||
        name.endsWith('.heic') || name.endsWith('.heif')) {
        return loadHeic(file);
    }
    return loadImageFromFile(file);
}

/* ------------------------- QUEUE MANAGEMENT ------------------------- */

/** Render the file queue in the UI */
function renderQueue() {
    fileListDiv.innerHTML = '';
    noImageMsg.style.display = uploadedImages.length === 0 ? 'block' : 'none';
    clearQueueBtn.style.display = uploadedImages.length === 0 ? 'none' : 'block';

    uploadedImages.forEach(item => {
        const row = document.createElement('div');
        row.className = 'file-item';
        row.dataset.id = item.id;
        row.innerHTML = `
            <img src="${item.objectURL}" alt="${item.file.name}" class="file-thumb">
            <div class="file-info">
                <span class="file-name">${item.file.name}</span>
                <span class="file-meta">${item.width}×${item.height} · ${(item.file.size / 1024).toFixed(1)} KB</span>
            </div>
            <button class="remove-btn" data-id="${item.id}" title="Remove">✕</button>
        `;
        fileListDiv.appendChild(row);
    });
}

/** Add an array of files to the conversion queue */
async function addFiles(files) {
    for (const file of files) {
        if (!file.type.startsWith('image/') &&
            !file.name.match(/\.(heic|heif|tif|tiff)$/i)) continue;

        try {
            const { imgElement, width, height, objectURL } = await loadAnyImage(file);
            uploadedImages.push({
                id: ++counter,
                file,
                imgElement,
                width,
                height,
                objectURL
            });
        } catch (err) {
            showError(`Could not load "${file.name}": ${err.message}`);
        }
    }
    renderQueue();
}

/** Remove a single item from the queue by its ID */
function removeItem(id) {
    const idx = uploadedImages.findIndex(i => i.id === id);
    if (idx === -1) return;
    URL.revokeObjectURL(uploadedImages[idx].objectURL);
    uploadedImages.splice(idx, 1);
    renderQueue();
}

/* ------------------------- CONVERSION ------------------------- */

/** Map MIME type to file extension */
function outputExtension(mime) {
    return {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/avif': 'avif',
        'image/tiff': 'tiff',
        'image/x-icon': 'ico'
    }[mime] || 'bin';
}

/** Convert all queued images and display results */
async function convertAll() {
    if (uploadedImages.length === 0) {
        showError('Add at least one image first.');
        return;
    }

    revokeResultURLs();
    resultsListDiv.innerHTML = '';
    resultArea.style.display = 'none';
    downloadAllBtn.style.display = 'none';
    convertBtn.disabled = true;
    convertBtn.innerText = 'Converting…';

    const fmt = outputFormatSelect.value;
    const quality = parseFloat(qualitySlider.value);
    const maxW = parseInt(maxWidthInput.value) || 0;
    const maxH = parseInt(maxHeightInput.value) || 0;

    for (const item of uploadedImages) {
        try {
            const { width, height } = calcNewDimensions(item.width, item.height, maxW, maxH);
            let blob;

            if (fmt === 'image/tiff') {
                blob = await encodeTiff(item.imgElement, width, height);
            } else if (fmt === 'image/avif') {
                blob = await encodeAvif(item.imgElement, width, height, quality);
            } else if (fmt === 'image/x-icon') {
                blob = await encodeIco(item.imgElement);
            } else {
                blob = await encodeViaCanvas(item.imgElement, width, height, fmt, quality);
            }

            const ext = outputExtension(fmt);
            const base = item.file.name.replace(/\.[^.]+$/, '');
            const name = `${base}.${ext}`;
            const outputURL = URL.createObjectURL(blob);

            results.push({
                id: item.id,
                blob,
                outputURL,
                name,
                sizeKB: (blob.size / 1024).toFixed(1)
            });

            // Render result row
            const row = document.createElement('div');
            row.className = 'result-item';
            row.innerHTML = `
                <img src="${outputURL}" alt="${name}" class="result-thumb">
                <div class="file-info">
                    <span class="file-name">${name}</span>
                    <span class="file-meta">${width}×${height} · ${(blob.size / 1024).toFixed(1)} KB</span>
                </div>
                <a href="${outputURL}" download="${name}" class="btn-download-single" title="Download">⬇</a>
            `;
            resultsListDiv.appendChild(row);
        } catch (err) {
            showError(`"${item.file.name}" failed: ${err.message}`);
        }
    }

    resultArea.style.display = 'block';
    if (results.length > 1) downloadAllBtn.style.display = 'block';
    convertBtn.disabled = false;
    convertBtn.innerText = 'Convert All';
}

/* ------------------------- ZIP DOWNLOAD ------------------------- */

/** Package all conversion results into a ZIP archive and trigger download */
async function downloadAllAsZip() {
    if (results.length === 0) return;

    const zip = new JSZip();
    for (const r of results) {
        zip.file(r.name, r.blob);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zorio-converted.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ------------------------- EVENT LISTENERS ------------------------- */

selectFileBtn.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('click', e => {
    if (e.target !== selectFileBtn) fileInput.click();
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
        addFiles(Array.from(fileInput.files));
        fileInput.value = '';   // allow re-uploading the same file
    }
});

uploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
});
uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
});
uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
});

fileListDiv.addEventListener('click', e => {
    const btn = e.target.closest('.remove-btn');
    if (btn) removeItem(parseInt(btn.dataset.id));
});

clearQueueBtn.addEventListener('click', () => {
    revokeAllImageURLs();
    revokeResultURLs();
    resultsListDiv.innerHTML = '';
    resultArea.style.display = 'none';
    downloadAllBtn.style.display = 'none';
    renderQueue();
});

convertBtn.addEventListener('click', convertAll);
downloadAllBtn.addEventListener('click', downloadAllAsZip);

outputFormatSelect.addEventListener('change', toggleQualityControl);
qualitySlider.addEventListener('input', updateQualitySlider);

/* ------------------------- INITIALIZATION ------------------------- */

toggleQualityControl();
updateQualitySlider();
renderQueue();