const SUPABASE_URL = "https://vzqicidepdmraygulrey.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_kqRWgOmLISOE2EuLL1s8fw_WN6FJRTI";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* :::::::::::::::::::::::::: GLOBAL STATE :::::::::::::::::::::::::: */
let currentUser = null;
let currentProfile = null;
let sidebarComponent = null;
let converterInitialized = false;

/* :::::::::::::::::::::::::: DOM REFERENCES :::::::::::::::::::::::::: */
const initialLoader = document.getElementById("initial-loader");
const authOverlay = document.getElementById("auth-overlay");
const appContainer = document.getElementById("app-container");

/* :::::::::::::::::::::::::: HELPERS :::::::::::::::::::::::::: */
function showGlobalLoader() {
    const loader = document.getElementById("initial-loader");
    if (loader) loader.classList.remove("hidden");
}

function hideGlobalLoader() {
    const loader = document.getElementById("initial-loader");
    if (loader) loader.classList.add("hidden");
}

function openModal(modal) {
    modal.style.display = "flex";
    modal.classList.remove("hidden");
}

function closeModal(modal) {
    modal.style.display = "none";
    modal.classList.add("hidden");
}

function showStep(stepId) {
    document.querySelectorAll(".auth-step").forEach((s) => {
        s.classList.remove("auth-step--active");
        s.classList.remove("active");
    });

    const step = document.getElementById(stepId);
    if (step) {
        step.classList.add("auth-step--active");
        step.classList.add("active");
    }
}

/* :::::::::::::::::::::::::: SIDEBAR COMPONENT :::::::::::::::::::::::::: */
function getSidebarComponent() {
    if (!sidebarComponent) {
        sidebarComponent = document.querySelector("sidebar-component");
        if (sidebarComponent) {
            sidebarComponent.addEventListener("login-request", () => {
                document.getElementById("auth-email").value = "";
                document.getElementById("auth-password-login").value = "";
                document.getElementById("auth-password-register").value = "";

                const confirmPass = document.getElementById("auth-confirm-password");
                if (confirmPass) confirmPass.value = "";

                document
                    .querySelectorAll(".auth-error")
                    .forEach((el) => el.classList.add("hidden"));

                showStep("step-1");
                openModal(authOverlay);
            });

            sidebarComponent.addEventListener("logout-request", () => logout());
            sidebarComponent.addEventListener("today-item-click", (e) => {
                console.log("[Zorio] today-item-click", e.detail);
            });
        }
    }
    return sidebarComponent;
}

async function buildCurrentProfile(user) {
    const { data: profileRow } = await sb
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    const md = user.user_metadata || {};
    return {
        id: user.id,
        first_name: profileRow?.first_name ?? md.first_name ?? "",
        last_name: profileRow?.last_name ?? md.last_name ?? "",
        photo_url: profileRow?.photo_url ?? md.photo_url ?? "",
        username: profileRow?.username ?? md.username ?? "",
        role: profileRow?.role ?? md.role ?? "recruit",
    };
}

function syncSidebarComponent() {
    const comp = getSidebarComponent();
    if (!comp || typeof comp.setUser !== "function") return;

    if (currentUser) {
        comp.setUser(currentUser, currentProfile);
    } else {
        comp.clearUser();
    }

    comp.setTodayList([], []);
    comp.setEvents([]);
    updateNotificationDot();

    const nav = comp.shadowRoot?.getElementById("sidebar-nav");
    if (nav) nav.style.display = "block";

    removeNoEventsPlaceholder();
}

function removeNoEventsPlaceholder() {
    const comp = getSidebarComponent();
    if (!comp || !comp.shadowRoot) return;

    const allElements = comp.shadowRoot.querySelectorAll("div");
    allElements.forEach((el) => {
        if (el.textContent.trim() === "No events today") {
            el.remove();
        }
    });

    const styledDiv = comp.shadowRoot.querySelector(
        'div[style*="padding:8px 16px"][style*="font-size:12px"][style*="color:#555"]',
    );
    if (styledDiv) styledDiv.remove();
}

/* :::::::::::::::::::::::::: NOTIFICATION DOT :::::::::::::::::::::::::: */
async function updateNotificationDot() {
    const comp = getSidebarComponent();
    if (!comp || !comp.shadowRoot) return;

    const dot = comp.shadowRoot.getElementById("avatar-notif-dot");
    if (!dot) return;

    let user = currentUser;
    if (!user) {
        const {
            data: { session },
        } = await sb.auth.getSession();
        user = session?.user || null;
    }

    if (!user) {
        dot.style.display = "none";
        return;
    }

    try {
        const [notifRes, ravloRes] = await Promise.all([
            sb
                .from("notifications")
                .select("id")
                .eq("user_id", user.id)
                .eq("is_read", false)
                .limit(1),
            sb
                .from("ravlo")
                .select("id")
                .eq("user_id", user.id)
                .gte("start_date", new Date().toISOString().split("T")[0])
                .limit(1),
        ]);

        const hasUnread = notifRes.data?.length > 0;
        const hasUpcomingEvents = ravloRes.data?.length > 0;

        dot.style.display = hasUnread || hasUpcomingEvents ? "block" : "none";
    } catch (err) {
        console.error("[NotificationDot]", err);
        dot.style.display = "none";
    }
}

/* :::::::::::::::::::::::::: AUTHENTICATION :::::::::::::::::::::::::: */
async function logout() {
    showGlobalLoader();

    try {
        await sb.auth.signOut();
        currentUser = null;
        currentProfile = null;
        syncSidebarComponent();

        authOverlay.querySelector("#auth-email").value = "";
        authOverlay.querySelector("#auth-password-login").value = "";
        authOverlay.querySelector("#auth-password-register").value = "";
        showStep("step-1");
    } finally {
        hideGlobalLoader();
    }
}

async function restoreSession() {
    showGlobalLoader();

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const accessToken = urlParams.get("access_token");
        const refreshToken = urlParams.get("refresh_token");
        if (accessToken && refreshToken) {
            try {
                await sb.auth.setSession({ access_token, refreshToken });
                window.history.replaceState(
                    {},
                    document.title,
                    window.location.pathname,
                );
            } catch (e) {}
        }

        const {
            data: { session },
        } = await sb.auth.getSession();

        if (session?.user) {
            currentUser = session.user;
            currentProfile = await buildCurrentProfile(currentUser);
            syncSidebarComponent();
            if (!converterInitialized) {
                initConverter();
                converterInitialized = true;
            }
            appContainer.classList.remove("app-hidden");
        } else {
            appContainer.classList.remove("app-hidden");
            if (!converterInitialized) {
                initConverter();
                converterInitialized = true;
            }
        }
    } catch (err) {
        console.error("Restore session error:", err);
    } finally {
        hideGlobalLoader();
    }
}

function setupAuthListeners() {
    document.getElementById("auth-continue-btn").addEventListener("click", () => {
        const email = document.getElementById("auth-email").value.trim();
        const err = document.getElementById("auth-error-1");
        err.classList.add("hidden");

        if (!email) {
            err.textContent = "Please enter your email.";
            err.classList.remove("hidden");
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            err.textContent = "Please enter a valid email address.";
            err.classList.remove("hidden");
            return;
        }

        document.getElementById("login-email-display").textContent = email;
        document.getElementById("register-email-display").textContent = email;
        showStep("step-2-login");
    });

    document
        .getElementById("auth-signin-btn")
        .addEventListener("click", async () => {
            const email = document.getElementById("auth-email").value.trim();
            const password = document.getElementById("auth-password-login").value;
            const errEl = document.getElementById("auth-error-login");
            errEl.classList.add("hidden");

            if (!password) {
                errEl.textContent = "Password required.";
                errEl.classList.remove("hidden");
                return;
            }

            showGlobalLoader();

            try {
                const { data, error } = await sb.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) {
                    errEl.textContent = error.message;
                    errEl.classList.remove("hidden");
                    return;
                }
                currentUser = data.user;
                currentProfile = await buildCurrentProfile(data.user);
                closeModal(authOverlay);
                appContainer.classList.remove("app-hidden");
                syncSidebarComponent();
                if (!converterInitialized) {
                    initConverter();
                    converterInitialized = true;
                }
            } finally {
                hideGlobalLoader();
            }
        });

    document
        .getElementById("auth-register-btn")
        .addEventListener("click", async () => {
            const email = document.getElementById("auth-email").value.trim();
            const password = document.getElementById("auth-password-register").value;
            const confirmPassword = document
                .getElementById("auth-confirm-password")
                .value.trim();
            const firstName = document.getElementById("auth-first-name").value.trim();
            const lastName = document.getElementById("auth-last-name").value.trim();
            const errEl = document.getElementById("auth-error-register");
            errEl.classList.add("hidden");

            if (!firstName || !lastName) {
                errEl.textContent = "First and last name are required.";
                errEl.classList.remove("hidden");
                return;
            }

            if (password.length < 6) {
                errEl.textContent = "Password must be at least 6 characters.";
                errEl.classList.remove("hidden");
                return;
            }

            if (password !== confirmPassword) {
                errEl.textContent = "Passwords do not match.";
                errEl.classList.remove("hidden");
                return;
            }

            showGlobalLoader();

            try {
                const { error } = await sb.auth.signUp({
                    email,
                    password,
                    options: {
                        data: { first_name: firstName, last_name: lastName },
                        emailRedirectTo: window.location.origin + window.location.pathname,
                    },
                });

                if (error) {
                    errEl.textContent = error.message;
                    errEl.classList.remove("hidden");
                    return;
                }
                alert(
                    "Registration successful! Please check your email to confirm your account.",
                );
                closeModal(authOverlay);
            } finally {
                hideGlobalLoader();
            }
        });

    document
        .getElementById("auth-back-to-email")
        .addEventListener("click", () => showStep("step-1"));
    document
        .getElementById("auth-back-to-email-2")
        .addEventListener("click", () => showStep("step-2-login"));

    document.getElementById("forgot-link").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("forgot-email").value = document
            .getElementById("auth-email")
            .value.trim();
        showStep("step-forgot");
    });

    document
        .getElementById("auth-reset-btn")
        .addEventListener("click", async () => {
            const email = document.getElementById("forgot-email").value.trim();
            if (!email) {
                const msg = document.getElementById("forgot-message");
                msg.textContent = "Please enter your email.";
                msg.classList.remove("hidden");
                msg.style.color = "#FF5555";
                return;
            }

            showGlobalLoader();

            try {
                const { error } = await sb.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin + window.location.pathname,
                });

                const msg = document.getElementById("forgot-message");
                msg.classList.remove("hidden");
                if (error) {
                    msg.textContent = error.message;
                    msg.style.color = "#FF5555";
                } else {
                    msg.textContent = "Reset link sent! Check your email.";
                    msg.style.color = "var(--accent)";
                }
            } finally {
                hideGlobalLoader();
            }
        });

    document
        .getElementById("auth-back-to-login")
        .addEventListener("click", () => showStep("step-2-login"));

    authOverlay.addEventListener("click", (e) => {
        if (e.target === authOverlay) {
            closeModal(authOverlay);
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && authOverlay.style.display === "flex") {
            closeModal(authOverlay);
        }
    });
}

/* :::::::::::::::::::::::::: IMAGE CONVERTER :::::::::::::::::::::::::: */
function initConverter() {
    const fileInput = document.getElementById("fileInput");
    const selectFileBtn = document.getElementById("selectFileBtn");
    const uploadArea = document.getElementById("uploadArea");
    const fileListDiv = document.getElementById("fileList");
    const clearQueueBtn = document.getElementById("clearQueueBtn");
    const noImageMsg = document.getElementById("noImageMsg");
    const outputFormatSelect = document.getElementById("outputFormat");
    const qualitySlider = document.getElementById("qualitySlider");
    const qualityValSpan = document.getElementById("qualityVal");
    const qualityGroup = document.getElementById("qualityGroup");
    const maxWidthInput = document.getElementById("maxWidth");
    const maxHeightInput = document.getElementById("maxHeight");
    const convertBtn = document.getElementById("convertBtn");
    const resultArea = document.getElementById("resultArea");
    const resultsListDiv = document.getElementById("resultsList");
    const downloadAllBtn = document.getElementById("downloadAllBtn");
    const errorMsgDiv = document.getElementById("errorMsg");
    const avifNotice = document.getElementById("avifNotice");

    let uploadedImages = [];
    let results = [];
    let counter = 0;
    let avifEncodeModule = null;

    /* :::::::::::::::::::::::::: CONVERTER UTILITIES :::::::::::::::::::::::::: */
    function showError(msg) {
        errorMsgDiv.textContent = msg;
        errorMsgDiv.classList.remove("hidden");
        setTimeout(() => errorMsgDiv.classList.add("hidden"), 5000);
    }

    function revokeAllImageURLs() {
        uploadedImages.forEach(
            (img) => img.objectURL && URL.revokeObjectURL(img.objectURL),
        );
        uploadedImages = [];
    }

    function revokeResultURLs() {
        results.forEach((r) => r.outputURL && URL.revokeObjectURL(r.outputURL));
        results = [];
    }

    function toggleQualityControl() {
        const noQuality = ["image/png", "image/tiff", "image/x-icon"].includes(
            outputFormatSelect.value,
        );
        qualitySlider.disabled = noQuality;
        qualityGroup.classList.toggle("muted", noQuality);
        avifNotice.classList.toggle(
            "hidden",
            outputFormatSelect.value !== "image/avif",
        );
    }

    function updateQualitySlider() {
        const percent = Math.round(qualitySlider.value * 100);
        qualityValSpan.textContent = `${percent}%`;
        qualitySlider.style.setProperty("--quality-percent", `${percent}%`);
    }

    function calcNewDimensions(imgW, imgH, maxW, maxH) {
        let targetW = imgW;
        let targetH = imgH;
        let resized = false;
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
            resized,
        };
    }

    function getImageData(imgElement, width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(imgElement, 0, 0, width, height);
        return { canvas, ctx, imageData: ctx.getImageData(0, 0, width, height) };
    }

    /* :::::::::::::::::::::::::: CONVERTER ENCODERS :::::::::::::::::::::::::: */
    function encodeViaCanvas(imgElement, width, height, mime, quality) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (mime === "image/jpeg") {
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, width, height);
            }
            ctx.drawImage(imgElement, 0, 0, width, height);
            canvas.toBlob(
                (blob) =>
                    blob
                        ? resolve(blob)
                        : reject(new Error("canvas.toBlob returned null")),
                mime,
                quality,
            );
        });
    }

    function encodeTiff(imgElement, width, height) {
        if (typeof UTIF === "undefined") {
            return Promise.reject(new Error("UTIF.js not loaded."));
        }
        const { imageData } = getImageData(imgElement, width, height);
        const tiffBuffer = UTIF.encodeImage(imageData.data, width, height);
        return Promise.resolve(new Blob([tiffBuffer], { type: "image/tiff" }));
    }

    async function encodeAvif(imgElement, width, height, quality) {
        if (!avifEncodeModule) {
            try {
                avifEncodeModule =
                    await import("https://cdn.jsdelivr.net/npm/@jsquash/avif@1.3.0/encode.js");
                if (typeof avifEncodeModule.default === "function") {
                    await avifEncodeModule.default();
                }
            } catch (err) {
                throw new Error(`Failed to load AVIF encoder: ${err.message}`);
            }
        }
        const { imageData } = getImageData(imgElement, width, height);
        const avifQuality = Math.round(quality * 100);
        const avifBuffer = await avifEncodeModule.encode(imageData, {
            quality: avifQuality,
            qualityAlpha: avifQuality,
            speed: 6,
        });
        return new Blob([avifBuffer], { type: "image/avif" });
    }

    function encodeIco(imgElement) {
        const sizes = [16, 32, 48];
        const frames = sizes.map((size) => {
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(imgElement, 0, 0, size, size);
            return { size, data: ctx.getImageData(0, 0, size, size).data };
        });

        const bmpFrames = frames.map(({ size, data }) => {
            const pixelCount = size * size;
            const andMaskRowBytes = Math.ceil(size / 8) * 4;
            const andMaskSize = andMaskRowBytes * size;
            const bmpSize = 40 + pixelCount * 4 + andMaskSize;
            const buf = new ArrayBuffer(bmpSize);
            const view = new DataView(buf);

            view.setUint32(0, 40, true);
            view.setInt32(4, size, true);
            view.setInt32(8, size * 2, true);
            view.setUint16(12, 1, true);
            view.setUint16(14, 32, true);
            view.setUint32(16, 0, true);
            view.setUint32(20, pixelCount * 4, true);
            view.setUint32(24, 0, true);
            view.setUint32(28, 0, true);
            view.setUint32(32, 0, true);
            view.setUint32(36, 0, true);

            let offset = 40;
            for (let row = size - 1; row >= 0; row--) {
                for (let col = 0; col < size; col++) {
                    const i = (row * size + col) * 4;
                    view.setUint8(offset++, data[i + 2]);
                    view.setUint8(offset++, data[i + 1]);
                    view.setUint8(offset++, data[i]);
                    view.setUint8(offset++, data[i + 3]);
                }
            }
            return new Uint8Array(buf);
        });

        const numImages = bmpFrames.length;
        const headerSize = 6 + numImages * 16;
        let dataOffset = headerSize;
        const totalSize =
            headerSize + bmpFrames.reduce((s, f) => s + f.byteLength, 0);
        const icoBuffer = new ArrayBuffer(totalSize);
        const icoView = new DataView(icoBuffer);
        const icoBytes = new Uint8Array(icoBuffer);

        icoView.setUint16(0, 0, true);
        icoView.setUint16(2, 1, true);
        icoView.setUint16(4, numImages, true);

        bmpFrames.forEach((frame, i) => {
            const size = sizes[i];
            const entryOffset = 6 + i * 16;
            icoView.setUint8(entryOffset + 0, size === 256 ? 0 : size);
            icoView.setUint8(entryOffset + 1, size === 256 ? 0 : size);
            icoView.setUint8(entryOffset + 2, 0);
            icoView.setUint8(entryOffset + 3, 0);
            icoView.setUint16(entryOffset + 4, 1, true);
            icoView.setUint16(entryOffset + 6, 32, true);
            icoView.setUint32(entryOffset + 8, frame.byteLength, true);
            icoView.setUint32(entryOffset + 12, dataOffset, true);
            icoBytes.set(frame, dataOffset);
            dataOffset += frame.byteLength;
        });

        return Promise.resolve(new Blob([icoBuffer], { type: "image/x-icon" }));
    }

    /* :::::::::::::::::::::::::: CONVERTER IMAGE LOADERS :::::::::::::::::::::::::: */
    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const objectURL = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () =>
                resolve({
                    imgElement: img,
                    width: img.width,
                    height: img.height,
                    objectURL,
                });
            img.onerror = () => {
                URL.revokeObjectURL(objectURL);
                reject(new Error("Failed to load image."));
            };
            img.src = objectURL;
        });
    }

    async function loadTiff(file) {
        if (typeof UTIF === "undefined") throw new Error("UTIF.js not loaded.");
        const arrayBuffer = await file.arrayBuffer();
        const ifds = UTIF.decode(arrayBuffer);
        if (!ifds?.length) throw new Error("Could not decode TIFF.");
        UTIF.decodeImage(arrayBuffer, ifds[0]);
        const rgba = UTIF.toRGBA8(ifds[0]);
        const width = ifds[0].width;
        const height = ifds[0].height;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(rgba);
        ctx.putImageData(imageData, 0, 0);

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) return reject(new Error("Failed to create preview."));
                const objectURL = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () =>
                    resolve({ imgElement: img, width, height, objectURL });
                img.onerror = () => {
                    URL.revokeObjectURL(objectURL);
                    reject(new Error("Failed to load TIFF preview."));
                };
                img.src = objectURL;
            }, "image/png");
        });
    }

    async function loadHeic(file) {
        if (typeof heic2any === "undefined")
            throw new Error("heic2any not loaded.");
        const blob = await heic2any({
            blob: file,
            toType: "image/jpeg",
            quality: 0.92,
        });
        const outputBlob = Array.isArray(blob) ? blob[0] : blob;
        return loadImageFromFile(outputBlob);
    }

    async function loadAnyImage(file) {
        const name = file.name.toLowerCase();
        const type = file.type.toLowerCase();
        if (
            type === "image/tiff" ||
            name.endsWith(".tif") ||
            name.endsWith(".tiff")
        )
            return loadTiff(file);
        if (
            type === "image/heic" ||
            type === "image/heif" ||
            name.endsWith(".heic") ||
            name.endsWith(".heif")
        )
            return loadHeic(file);
        return loadImageFromFile(file);
    }

    /* :::::::::::::::::::::::::: CONVERTER QUEUE MANAGEMENT :::::::::::::::::::::::::: */
    function renderQueue() {
        fileListDiv.innerHTML = "";
        noImageMsg.classList.toggle("hidden", uploadedImages.length !== 0);
        clearQueueBtn.classList.toggle("hidden", uploadedImages.length === 0);

        uploadedImages.forEach((item) => {
            const row = document.createElement("div");
            row.className = "file-item";
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

    async function addFiles(files) {
        for (const file of files) {
            if (
                !file.type.startsWith("image/") &&
                !file.name.match(/\.(heic|heif|tif|tiff)$/i)
            )
                continue;
            try {
                const { imgElement, width, height, objectURL } =
                    await loadAnyImage(file);
                uploadedImages.push({
                    id: ++counter,
                    file,
                    imgElement,
                    width,
                    height,
                    objectURL,
                });
            } catch (err) {
                showError(`Could not load "${file.name}": ${err.message}`);
            }
        }
        renderQueue();
    }

    function removeItem(id) {
        const idx = uploadedImages.findIndex((i) => i.id === id);
        if (idx === -1) return;
        URL.revokeObjectURL(uploadedImages[idx].objectURL);
        uploadedImages.splice(idx, 1);
        renderQueue();
    }

    /* :::::::::::::::::::::::::: CONVERTER CONVERSION :::::::::::::::::::::::::: */
    function outputExtension(mime) {
        return (
            {
                "image/jpeg": "jpg",
                "image/png": "png",
                "image/webp": "webp",
                "image/avif": "avif",
                "image/tiff": "tiff",
                "image/x-icon": "ico",
            }[mime] || "bin"
        );
    }

    async function convertAll() {
        if (uploadedImages.length === 0) {
            showError("Add at least one image first.");
            return;
        }

        revokeResultURLs();
        resultsListDiv.innerHTML = "";
        resultArea.classList.add("hidden");
        downloadAllBtn.classList.add("hidden");
        convertBtn.disabled = true;
        convertBtn.textContent = "Converting…";

        const fmt = outputFormatSelect.value;
        const quality = parseFloat(qualitySlider.value);
        const maxW = parseInt(maxWidthInput.value) || 0;
        const maxH = parseInt(maxHeightInput.value) || 0;

        for (const item of uploadedImages) {
            try {
                const { width, height } = calcNewDimensions(
                    item.width,
                    item.height,
                    maxW,
                    maxH,
                );
                let blob;

                if (fmt === "image/tiff")
                    blob = await encodeTiff(item.imgElement, width, height);
                else if (fmt === "image/avif")
                    blob = await encodeAvif(item.imgElement, width, height, quality);
                else if (fmt === "image/x-icon")
                    blob = await encodeIco(item.imgElement);
                else
                    blob = await encodeViaCanvas(
                        item.imgElement,
                        width,
                        height,
                        fmt,
                        quality,
                    );

                const ext = outputExtension(fmt);
                const base = item.file.name.replace(/\.[^.]+$/, "");
                const name = `${base}.${ext}`;
                const outputURL = URL.createObjectURL(blob);

                results.push({
                    id: item.id,
                    blob,
                    outputURL,
                    name,
                    sizeKB: (blob.size / 1024).toFixed(1),
                });

                const row = document.createElement("div");
                row.className = "result-item";
                row.innerHTML = `
          <img src="${outputURL}" alt="${name}" class="result-thumb">
          <div class="file-info">
            <span class="file-name">${name}</span>
            <span class="file-meta">${width}×${height} · ${(blob.size / 1024).toFixed(1)} KB</span>
          </div>
          <a href="${outputURL}" download="${name}" class="download-single-btn" title="Download">⬇</a>
        `;
                resultsListDiv.appendChild(row);
            } catch (err) {
                showError(`"${item.file.name}" failed: ${err.message}`);
            }
        }

        resultArea.classList.remove("hidden");
        downloadAllBtn.classList.toggle("hidden", results.length <= 1);
        convertBtn.disabled = false;
        convertBtn.textContent = "Convert All";
    }

    async function downloadAllAsZip() {
        if (results.length === 0) return;
        const zip = new JSZip();
        results.forEach((r) => zip.file(r.name, r.blob));
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "zorio-converted.zip";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    /* :::::::::::::::::::::::::: CONVERTER EVENT LISTENERS :::::::::::::::::::::::::: */
    selectFileBtn.addEventListener("click", () => fileInput.click());
    uploadArea.addEventListener("click", (e) => {
        if (e.target !== selectFileBtn) fileInput.click();
    });
    fileInput.addEventListener("change", () => {
        if (fileInput.files.length) {
            addFiles(Array.from(fileInput.files));
            fileInput.value = "";
        }
    });

    uploadArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadArea.classList.add("drag-over");
    });
    uploadArea.addEventListener("dragleave", () =>
        uploadArea.classList.remove("drag-over"),
    );
    uploadArea.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadArea.classList.remove("drag-over");
        if (e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
    });

    fileListDiv.addEventListener("click", (e) => {
        const btn = e.target.closest(".remove-btn");
        if (btn) removeItem(parseInt(btn.dataset.id));
    });

    clearQueueBtn.addEventListener("click", () => {
        revokeAllImageURLs();
        revokeResultURLs();
        resultsListDiv.innerHTML = "";
        resultArea.classList.add("hidden");
        downloadAllBtn.classList.add("hidden");
        renderQueue();
    });

    convertBtn.addEventListener("click", convertAll);
    downloadAllBtn.addEventListener("click", downloadAllAsZip);
    outputFormatSelect.addEventListener("change", toggleQualityControl);
    qualitySlider.addEventListener("input", updateQualitySlider);

    const newImageBtn = document.getElementById("tool-new-item");
    if (newImageBtn)
        newImageBtn.addEventListener("click", () => fileInput.click());

    /* :::::::::::::::::::::::::: CONVERTER INITIALIZATION :::::::::::::::::::::::::: */
    toggleQualityControl();
    updateQualitySlider();
    renderQueue();
}

/* :::::::::::::::::::::::::: DOM READY :::::::::::::::::::::::::: */
document.addEventListener("DOMContentLoaded", async () => {
    setupAuthListeners();

    customElements.whenDefined("sidebar-component").then(() => {
        getSidebarComponent();
        syncSidebarComponent();
    });

    await restoreSession();
});