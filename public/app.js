// SPDX-License-Identifier: AGPL-3.0-or-later
const TILE_SIZE = 300;
const IMAGE_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 20000;
const GENERATION_TIMEOUT_MS = 60000;
const MAX_PAGES = 5;
const IMAGE_CONCURRENCY = 6;
const cancelBtn = document.getElementById("cancel-btn");
const resultNotice = document.getElementById("result-notice");
const form = document.getElementById("collage-form");
const canvas = document.getElementById("collage-canvas");
const ctx = canvas.getContext("2d");
const collageImg = document.getElementById("collage-img");
const loading = document.getElementById("loading");
const result = document.getElementById("result");
const error = document.getElementById("error");
const downloadLink = document.getElementById("download-link");
const submitBtn = document.getElementById("submit-btn");
const loadingText = document.getElementById("loading-text");
const copyBtn = document.getElementById("copy-btn");
const periodSelect = document.getElementById("period");
const sizeSelect = document.getElementById("size");
const ALLOWED_PERIODS = new Set(Array.from(periodSelect.options, (o) => o.value));
const ALLOWED_SIZES = new Set(Array.from(sizeSelect.options, (o) => o.value));

function loadImage(url, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        if (!url) { resolve(null); return; }
        const img = new Image();
        let retry;
        let retries = 1;
        const finish = (value, err) => {
            clearTimeout(timeout);
            clearTimeout(retry);
            img.onload = img.onerror = null;
            signal.removeEventListener("abort", abort);
            if (!value) img.removeAttribute("src");
            if (err) reject(err); else resolve(value);
        };
        const abort = () => finish(null, signal.reason);
        const timeout = setTimeout(() => finish(null), IMAGE_TIMEOUT_MS);
        signal.addEventListener("abort", abort, { once: true });
        img.crossOrigin = "anonymous";
        img.onload = () => finish(img);
        img.onerror = () => {
            if (retries-- > 0) {
                retry = setTimeout(() => { img.src = url; }, 500);
            } else {
                finish(null);
            }
        };
        img.src = url;
    });
}

async function fetchAlbumPage(params, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(
        new Error("Album data took too long to load. Please try again.")
    ), REQUEST_TIMEOUT_MS);
    try {
        const resp = await fetch(`/api/collage-data?${params}`, { signal: controller.signal });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data?.message || `Last.fm request failed (${resp.status})`);
        if (!Array.isArray(data?.albums)) throw new Error("Last.fm returned invalid album data.");
        return data;
    } catch (err) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw err;
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
    }
}

function canvasToBlob(type = "image/png", quality) {
    return new Promise((resolve, reject) =>
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Failed to render image.")), type, quality)
    );
}

function fitText(text, width) {
    const chars = Array.from(String(text));
    if (ctx.measureText(chars.join("")).width <= width) return chars.join("");
    while (chars.length && ctx.measureText(chars.join("") + "…").width > width) chars.pop();
    return chars.join("") + "…";
}

function drawTile(album, image, x, y, opts) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, TILE_SIZE, TILE_SIZE);
    ctx.clip();
    if (image) ctx.drawImage(image, x, y, TILE_SIZE, TILE_SIZE);
    const lines = [];
    if (!opts.hideCaptions) lines.push(album.artist, album.album);
    if (opts.showPlaycount) lines.push(`${album.playcount} plays`);
    lines.forEach((line, i) => {
        const text = fitText(line, TILE_SIZE - 12);
        if (opts.captionBackground && text.trim()) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
            ctx.fillRect(x + 2, y + 3 + i * 16, Math.min(TILE_SIZE - 4, ctx.measureText(text).width + 8), 16);
        }
        ctx.fillStyle = "white";
        ctx.strokeText(text, x + 6, y + 16 + i * 16);
        ctx.fillText(text, x + 6, y + 16 + i * 16);
    });
    ctx.restore();
}

async function generate(user, period, dim, opts, signal) {
    const slots = dim * dim;
    const params = new URLSearchParams({ user, period, size: String(dim) });
    if (opts.skipNocover) params.set("nocover", "true");
    const selected = [];
    const seen = new Set();
    let page = 1;
    let searchLimitReached = false;
    do {
        signal.throwIfAborted();
        params.set("page", String(page));
        loadingText.textContent = "Loading albums...";
        const data = await fetchAlbumPage(params, signal);
        const candidates = data.albums.filter(album => {
            const key = JSON.stringify([album.artist, album.album]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        loadingText.textContent = `Loading covers (${selected.length}/${slots})...`;
        for (let i = 0; i < candidates.length && selected.length < slots; i += IMAGE_CONCURRENCY) {
            signal.throwIfAborted();
            const batch = candidates.slice(i, i + IMAGE_CONCURRENCY);
            const images = await Promise.all(batch.map(album => loadImage(album.image_url, signal)));
            batch.forEach((album, j) => {
                if (selected.length < slots && (!opts.skipNocover || images[j])) {
                    selected.push({ album, image: images[j] });
                }
            });
            loadingText.textContent = `Loading covers (${selected.length}/${slots})...`;
        }
        searchLimitReached = data.searchLimitReached || (page === MAX_PAGES && !!data.nextPage);
        page = opts.skipNocover && data.nextPage === page + 1 && page < MAX_PAGES ? data.nextPage : null;
    } while (page && selected.length < slots);
    signal.throwIfAborted();
    if (!selected.length) throw new Error(opts.skipNocover
        ? "No usable covers found. Try a longer time period or turn off skipping albums without covers."
        : "No albums found for this user and time period.");

    canvas.width = dim * TILE_SIZE;
    canvas.height = dim * TILE_SIZE;
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "black";
    selected.forEach(({ album, image }, i) => drawTile(
        album, image, (i % dim) * TILE_SIZE, Math.floor(i / dim) * TILE_SIZE, opts
    ));
    const missing = selected.filter(item => !item.image).length;
    const notices = [];
    if (selected.length < slots) notices.push(`Filled ${selected.length} of ${slots} tiles.${searchLimitReached
        ? " Reached the cover search limit; try a longer time period or smaller grid."
        : " Not enough albums" + (opts.skipNocover ? " with usable covers" : "") + " were found."}`);
    if (missing) notices.push(`${missing} cover${missing === 1 ? "" : "s"} could not be loaded.`);
    resultNotice.textContent = notices.join(" ");
}

function getFormState() {
    return {
        user: document.getElementById("lastfm-profile").value.trim(),
        period: document.getElementById("period").value,
        size: document.getElementById("size").value,
        hideCaptions: document.getElementById("hide-captions").checked,
        showPlaycount: document.getElementById("show-playcount").checked,
        captionBackground: document.getElementById("caption-background").checked,
        skipNocover: document.getElementById("skip-nocover").checked,
    };
}

function updateURL(state) {
    const params = new URLSearchParams({ user: state.user });
    if (state.period !== "7day") params.set("period", state.period);
    if (state.size !== "5") params.set("size", state.size);
    if (state.hideCaptions) params.set("captions", "false");
    if (state.showPlaycount) params.set("playcount", "true");
    if (state.captionBackground) params.set("background", "true");
    if (state.skipNocover) params.set("nocover", "true");
    history.replaceState(null, "", "?" + params.toString());
}

function loadFromURL() {
    const params = new URLSearchParams(location.search);
    if (params.has("user")) document.getElementById("lastfm-profile").value = params.get("user");
    const period = params.get("period");
    if (ALLOWED_PERIODS.has(period)) periodSelect.value = period;
    const size = params.get("size");
    if (ALLOWED_SIZES.has(size)) sizeSelect.value = size;
    if (params.get("captions") === "false") document.getElementById("hide-captions").checked = true;
    if (params.get("playcount") === "true") document.getElementById("show-playcount").checked = true;
    if (params.get("nocover") === "true") document.getElementById("skip-nocover").checked = true;
    if (params.get("background") === "true") document.getElementById("caption-background").checked = true;
    if (params.has("auto")) submitForm();
}

function canCopyImage() {
    return window.isSecureContext && navigator.clipboard?.write && window.ClipboardItem;
}

let isGenerating = false;
let activeController;
async function submitForm() {
    if (isGenerating) return;
    const state = getFormState();
    if (!state.user) return;
    isGenerating = true;
    activeController = new AbortController();
    const { signal } = activeController;
    const generationTimeout = setTimeout(() => activeController.abort(
        new Error("Generation took too long. Try a smaller grid or try again.")
    ), GENERATION_TIMEOUT_MS);

    const dim = parseInt(state.size);

    loading.style.display = "flex";
    result.style.display = "none";
    error.style.display = "none";
    submitBtn.disabled = true;

    try {
        await generate(state.user, state.period, dim, state, signal);
        const baseName = `${state.user}_${state.period}_${dim}x${dim}`;
        const blob = await canvasToBlob("image/jpeg", 0.92);
        signal.throwIfAborted();
        updateURL(state);
        collageImg.alt = `${dim} by ${dim} top album collage for ${state.user}`;
        if (downloadLink.href.startsWith("blob:")) URL.revokeObjectURL(downloadLink.href);
        const url = URL.createObjectURL(blob);
        collageImg.src = url;
        downloadLink.href = url;
        downloadLink.download = `${baseName}.jpg`;
        result.style.display = "flex";
    } catch (err) {
        error.textContent = err.message || "Failed to generate collage.";
        error.style.display = "block";
    } finally {
        clearTimeout(generationTimeout);
        activeController = null;
        loading.style.display = "none";
        submitBtn.disabled = false;
        isGenerating = false;
    }
}

cancelBtn.addEventListener("click", () => activeController?.abort(new Error("Generation cancelled.")));

form.addEventListener("submit", (e) => { e.preventDefault(); submitForm(); });

copyBtn.addEventListener("click", async () => {
    const label = copyBtn.textContent;
    copyBtn.disabled = true;
    try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": canvasToBlob() })]);
        copyBtn.textContent = "Copied!";
    } catch {
        copyBtn.textContent = "Copy failed";
    } finally {
        setTimeout(() => { copyBtn.textContent = label; copyBtn.disabled = false; }, 2000);
    }
});

loadFromURL();
if (!canCopyImage()) {
    copyBtn.disabled = true;
    copyBtn.title = "Image clipboard copy is not available in this browser or context.";
}
