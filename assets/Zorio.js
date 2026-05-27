/*
  ****************************************************
  *  Author: Armin Silatani
  *  Date: 2026-05-18
  *  Version: 1.0.0
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

/* ------------------------- STATE ------------------------- */
let uploadedImages = [];   // { id, file, imgElement, width, height, objectURL }
let results = [];          // { id, blob, outputURL, name, sizeKB, originalName }

let counter = 0;

/* ------------------------- UTILITIES ------------------------- */
function showError(msg) {
    errorMsgDiv.style.display = 'block';
    errorMsgDiv.innerText = msg;
    setTimeout(() => errorMsgDiv.style.display = 'none', 4000);
}

function revokeAllImageURLs() {
    uploadedImages.forEach(img => {
        if (img.objectURL) URL.revokeObjectURL(img.objectURL);
    });
    uploadedImages = [];
}

function revokeResultURLs() {
    results.forEach(r => {
        if (r.outputURL) URL.revokeObjectURL(r.outputURL);
    });
    results = [];
}

function toggleQualityControl() {
    const isPng = outputFormatSelect.value === 'image/png';
    qualitySlider.disabled = isPng;
    qualityGroup.style.opacity = isPng ? '0.6' : '1';
}

function updateQualitySlider() {
    const percent = Math.round(qualitySlider.value * 100);
    qualityValSpan.innerText = `${percent}%`;
    qualitySlider.style.background =
        `linear-gradient(90deg, #FD7E14 ${percent}%, #1e1e2a ${percent}%)`;
}

function calcNewDimensions(imgW, imgH, maxW, maxH) {
    let targetW = imgW, targetH = imgH, resized = false;
    if (maxW && maxH && maxW > 0 && maxH > 0) {
        const scale = Math.min(maxW / imgW, maxH / imgH);
        if (scale < 1) { targetW = Math.floor(imgW * scale); targetH = Math.floor(imgH * scale); resized = true; }
    } else if (maxW && maxW > 0 && maxW < imgW) {
        targetW = maxW; targetH = Math.floor(imgH * (maxW / imgW)); resized = true;
    } else if (maxH && maxH > 0 && maxH < imgH) {
        targetH = maxH; targetW = Math.floor(imgW * (maxH / imgH)); resized = true;
    }
    return { width: Math.max(1, targetW), height: Math.max(1, targetH), resized };
}

/* ------------------------- IMAGE LOADING ------------------------- */
function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            return reject(new Error('Invalid image file.'));
        }
        const objectURL = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve({ imgElement: img, width: img.width, height: img.height, objectURL });
        img.onerror = () => {
            URL.revokeObjectURL(objectURL);
            reject(new Error('Failed to load image.'));
        };
        img.src = objectURL;
    });
}

/* HEIC support wrapper (uses heic2any if available) */
async function loadImageMaybeHeic(file) {
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif' ||
                   (file.name && (file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')));
    if (isHeic && typeof heic2any !== 'undefined') {
        const convertedBlob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
        const newFile = new File([convertedBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
        return await loadImageFromFile(newFile);
    } else {
        return await loadImageFromFile(file);
    }
}

/* ------------------------- ADD / REMOVE FILES ------------------------- */
async function addFiles(fileArray) {
    const validFiles = Array.from(fileArray).filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) {
        showError('No valid image files selected.');
        return;
    }
    noImageMsg.style.display = 'none';
    for (const file of validFiles) {
        try {
            const { imgElement, width, height, objectURL } = await loadImageMaybeHeic(file);
            const newEntry = {
                id: ++counter,
                file,
                imgElement,
                width,
                height,
                objectURL
            };
            uploadedImages.push(newEntry);
            renderFileItem(newEntry);
        } catch (err) {
            showError(`Skipping ${file.name}: ${err.message}`);
        }
    }
    updateQueueUI();
}

function removeFile(id) {
    const idx = uploadedImages.findIndex(img => img.id === id);
    if (idx > -1) {
        URL.revokeObjectURL(uploadedImages[idx].objectURL);
        uploadedImages.splice(idx, 1);
    }
    renderFileList();
    updateQueueUI();
}

function clearQueue() {
    revokeAllImageURLs();
    uploadedImages = [];
    renderFileList();
    updateQueueUI();
    resetResultArea();
}

function updateQueueUI() {
    clearQueueBtn.style.display = uploadedImages.length > 0 ? 'block' : 'none';
    if (uploadedImages.length === 0) {
        noImageMsg.style.display = 'block';
    }
}

/* ------------------------- RENDER QUEUE LIST ------------------------- */
function renderFileItem(item) {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.dataset.id = item.id;
    div.innerHTML = `
        <img src="${item.objectURL}" alt="thumb" class="file-thumb">
        <div class="file-info">
            <div class="file-name">${item.file.name}</div>
            <div class="file-meta">${item.width}×${item.height} | ${(item.file.size / 1024).toFixed(1)} KB</div>
        </div>
        <button class="remove-btn" data-id="${item.id}">✕</button>
    `;
    fileListDiv.appendChild(div);
    // Event listener for remove button
    div.querySelector('.remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(item.id);
    });
}

function renderFileList() {
    fileListDiv.innerHTML = '';
    uploadedImages.forEach(item => renderFileItem(item));
}

/* ------------------------- CONVERSION ------------------------- */
async function convertAll() {
    if (uploadedImages.length === 0) {
        showError('Please add at least one image.');
        return;
    }
    errorMsgDiv.style.display = 'none';
    revokeResultURLs();
    results = [];

    const outputMime = outputFormatSelect.value;
    let quality = (outputMime !== 'image/png') ? parseFloat(qualitySlider.value) : null;
    if (quality && (isNaN(quality) || quality < 0.1)) quality = 0.85;

    let maxW = maxWidthInput.value.trim() === '' ? null : parseInt(maxWidthInput.value);
    let maxH = maxHeightInput.value.trim() === '' ? null : parseInt(maxHeightInput.value);
    if (maxW && (isNaN(maxW) || maxW <= 0)) maxW = null;
    if (maxH && (isNaN(maxH) || maxH <= 0)) maxH = null;

    for (const imgData of uploadedImages) {
        try {
            const { width, height, resized } = calcNewDimensions(imgData.width, imgData.height, maxW, maxH);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (outputMime === 'image/jpeg') {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
            }
            ctx.drawImage(imgData.imgElement, 0, 0, width, height);

            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Blob failed')), outputMime, quality);
            });

            const outputURL = URL.createObjectURL(blob);
            const baseName = imgData.file.name.replace(/\.[^/.]+$/, '') + '_converted';
            const ext = outputMime === 'image/png' ? '.png' : (outputMime === 'image/webp' ? '.webp' : '.jpg');
            const outputName = baseName + ext;

            results.push({
                id: imgData.id,
                blob,
                outputURL,
                name: outputName,
                sizeKB: (blob.size / 1024).toFixed(2),
                originalName: imgData.file.name,
                originalSizeKB: (imgData.file.size / 1024).toFixed(2),
                dimensions: `${width}×${height}`,
                resized
            });
        } catch (err) {
            showError(`Error converting ${imgData.file.name}: ${err.message}`);
        }
    }

    displayResults();
}

function displayResults() {
    resultsListDiv.innerHTML = '';
    if (results.length === 0) {
        resultArea.style.display = 'none';
        return;
    }
    results.forEach(r => {
        const div = document.createElement('div');
        div.className = 'result-item';
        div.innerHTML = `
            <img src="${r.outputURL}" class="result-thumb" alt="result">
            <div class="result-info">
                <div class="result-name">${r.name}</div>
                <div class="result-stats">
                    ${r.dimensions} | ${r.sizeKB} KB
                    (was ${r.originalSizeKB} KB)
                    ${r.resized ? ' <span style="color:#FD7E14;">resized</span>' : ''}
                </div>
            </div>
            <button class="download-single-btn" data-url="${r.outputURL}" data-name="${r.name}">⬇</button>
        `;
        resultsListDiv.appendChild(div);
        div.querySelector('.download-single-btn').addEventListener('click', (e) => {
            const url = e.target.dataset.url;
            const name = e.target.dataset.name;
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.click();
        });
    });

    resultArea.style.display = 'block';
    downloadAllBtn.style.display = (results.length > 1) ? 'block' : 'none';
}

/* ------------------------- DOWNLOAD ALL AS ZIP ------------------------- */
async function downloadAllAsZip() {
    if (results.length === 0) return;
    const zip = new JSZip();
    for (const r of results) {
        zip.file(r.name, r.blob);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const zipURL = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = zipURL;
    a.download = 'zorio_converted_images.zip';
    a.click();
    URL.revokeObjectURL(zipURL);
}

function resetResultArea() {
    resultArea.style.display = 'none';
    revokeResultURLs();
    results = [];
    resultsListDiv.innerHTML = '';
}

/* ------------------------- EVENT LISTENERS ------------------------- */
selectFileBtn.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#FD7E14';
    uploadArea.style.background = 'rgba(253,126,20,0.1)';
});
uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = 'rgba(253,126,20,0.5)';
    uploadArea.style.background = 'rgba(0,0,0,0.3)';
});
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'rgba(253,126,20,0.5)';
    uploadArea.style.background = 'rgba(0,0,0,0.3)';
    if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        addFiles(e.target.files);
        fileInput.value = '';  // allow re-selecting same files
    }
});

clearQueueBtn.addEventListener('click', clearQueue);

outputFormatSelect.addEventListener('change', toggleQualityControl);
qualitySlider.addEventListener('input', updateQualitySlider);
updateQualitySlider();
toggleQualityControl();

convertBtn.addEventListener('click', async () => {
    const originalText = convertBtn.innerText;
    convertBtn.innerText = 'Converting...';
    convertBtn.disabled = true;
    try {
        await convertAll();
    } catch (e) {
        console.warn(e);
    } finally {
        convertBtn.innerText = originalText;
        convertBtn.disabled = false;
    }
});

downloadAllBtn.addEventListener('click', downloadAllAsZip);

window.addEventListener('beforeunload', () => {
    revokeAllImageURLs();
    revokeResultURLs();
});

resetResultArea();