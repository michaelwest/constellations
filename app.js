const EQUATOR_BUFFER_DEG = 12; // keep near-equator stars mirrored when filtering latitudes (not used now for hemisphere)

const allStars = [];
let visibleStars = [];
const lines = [];

const highlightConstellations = {
  Ori: { color: "rgba(255, 92, 92, 0.9)", glow: "rgba(255, 92, 92, 0.2)" },
  Sco: { color: "rgba(255, 92, 92, 0.9)", glow: "rgba(255, 92, 92, 0.2)" },
  Cru: { color: "rgba(255, 210, 90, 0.9)", glow: "rgba(255, 210, 90, 0.2)" }
};
const highlightStars = new Map([
  ["hr-5267", { color: "rgba(255, 145, 255, 0.95)", glow: "rgba(255, 145, 255, 0.25)" }],
  ["hr-5459", { color: "rgba(255, 145, 255, 0.95)", glow: "rgba(255, 145, 255, 0.25)" }],
  ["hr-5460", { color: "rgba(255, 145, 255, 0.95)", glow: "rgba(255, 145, 255, 0.25)" }]
]);

const canvas = document.getElementById("sky");
const clearLinesButton = document.getElementById("clear-lines");
const selectionStatus = document.getElementById("selection-status");
const magnitudeSlider = document.getElementById("mag-limit");
const magnitudeValue = document.getElementById("mag-limit-value");
const saveButton = document.getElementById("save-image");
const saveModal = document.getElementById("save-modal");
const saveForm = document.getElementById("save-form");
const cancelSaveButton = document.getElementById("cancel-save");
const nameInput = document.getElementById("constellation-name");
const hoverLabel = document.getElementById("hover-label");
const ctx = canvas.getContext("2d");

let selectedStar = null;
let hoveredStar = null;

let renderWidth = 0;
let renderHeight = 0;
let pixelRatio = window.devicePixelRatio || 1;
let magnitudeLimit = parseFloat(magnitudeSlider?.value || "6.5");

function slugifyName(name) {
  return name
    ? name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : "";
}

function parseVmag(value) {
  const mag = parseFloat(value);
  return Number.isFinite(mag) ? mag : null;
}

function parseRaHours(text) {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)h\s*(\d+(?:\.\d+)?)m\s*(\d+(?:\.\d+)?)s/i);
  if (!match) return null;
  const hours = parseFloat(match[1]);
  const minutes = parseFloat(match[2]);
  const seconds = parseFloat(match[3]);
  if ([hours, minutes, seconds].some((n) => !Number.isFinite(n))) return null;
  return hours + minutes / 60 + seconds / 3600;
}

function parseDecDegrees(text) {
  if (!text) return null;
  const cleaned = text
    .replace(/[°º]/g, " ")
    .replace(/[′’']/g, " ")
    .replace(/[″”\"]/g, " ")
    .replace(/[+]/g, " +")
    .replace(/-/g, " -");
  const parts = cleaned.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const sign = parts[0].startsWith("-") ? -1 : 1;
  const degrees = Math.abs(parseFloat(parts[0]));
  const minutes = parseFloat(parts[1]);
  const seconds = parseFloat(parts[2]);
  if ([degrees, minutes, seconds].some((n) => !Number.isFinite(n))) return null;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function equatorialToXY(raHours, decDegrees) {
  // Map RA (0-24h) to full canvas width, Dec (+90 to -90) to canvas height (top to bottom).
  const x = clamp01(raHours / 24);
  const y = clamp01(1 - (decDegrees + 90) / 180);
  return { x, y };
}

function normalizeStar(entry, index) {
  const mag = parseVmag(entry.V ?? entry.Vmag);
  const ra = parseRaHours(entry.RA);
  const dec = parseDecDegrees(entry.Dec);
  if (mag === null || ra === null || dec === null) return null;
  const constellation = entry.C || entry.Const || null;
  const hr = entry.HR || null;
  const bayer = entry.B || null;
  const flamsteed = entry.F || null;
  const properName = entry.N || null;

  const id = entry.HR
    ? `hr-${entry.HR}`
    : entry.HD
    ? `hd-${entry.HD}`
    : entry.Name
    ? `nm-${slugifyName(entry.Name)}`
    : entry.F && entry.C
    ? `nm-${slugifyName(`${entry.F}-${entry.C}`)}`
    : `star-${index}`;
  const name =
    entry.Name ||
    (entry.F && entry.C ? `${entry.F} ${entry.C}` : entry.C) ||
    (entry.HR ? `HR ${entry.HR}` : entry.HD ? `HD ${entry.HD}` : id);
  const { x, y } = equatorialToXY(ra, dec);

  return { id, name, ra, dec, mag, x, y, constellation, hr, bayer, flamsteed, properName };
}

async function loadBrightStars() {
  selectionStatus.textContent = "Loading stars...";
  try {
    const response = await fetch("./bsc5-short.json");
    const catalog = await response.json();
    const parsed = catalog.map(normalizeStar).filter(Boolean);
    parsed.sort((a, b) => a.mag - b.mag);

    allStars.splice(0, allStars.length, ...parsed);
    selectedStar = null;
    lines.length = 0;
    selectionStatus.textContent = "Loaded star catalog";
    applyMagnitudeFilter();
  } catch (error) {
    console.error("Failed to load star catalog", error);
    selectionStatus.textContent = "Could not load stars";
  }
}

function applyMagnitudeFilter() {
  visibleStars = allStars.filter((star) => star.mag <= magnitudeLimit);
  if (selectedStar && !visibleStars.find((s) => s.id === selectedStar.id)) {
    selectedStar = null;
  }
  draw();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  renderWidth = rect.width || 600;
  renderHeight = rect.height || renderWidth;
  pixelRatio = window.devicePixelRatio || 1;

  canvas.width = renderWidth * pixelRatio;
  canvas.height = renderHeight * pixelRatio;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  draw();
}

function starRadius(mag) {
  return Math.max(1.5, 6 - mag);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, renderWidth, renderHeight);
  if (!visibleStars.length) {
    return;
  }
  drawLines();
  drawStars();
  drawSelection();
}
function drawLines() {
  ctx.save();
  ctx.strokeStyle = "rgba(123, 216, 255, 0.65)";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "rgba(123, 216, 255, 0.25)";
  ctx.shadowBlur = 8;

  lines.forEach(({ from, to }) => {
    const start = visibleStars.find((s) => s.id === from);
    const end = visibleStars.find((s) => s.id === to);
    if (!start || !end) return; // skip if hidden by filter
    ctx.beginPath();
    ctx.moveTo(start.x * renderWidth, start.y * renderHeight);
    ctx.lineTo(end.x * renderWidth, end.y * renderHeight);
    ctx.stroke();
  });

  ctx.restore();
}

function drawStars() {
  ctx.save();
  visibleStars.forEach((star) => {
    const x = star.x * renderWidth;
    const y = star.y * renderHeight;
    const radius = starRadius(star.mag);
    const highlight =
      highlightStars.get(star.id) ||
      (star.constellation && highlightConstellations[star.constellation]);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.4);
    gradient.addColorStop(0, highlight ? highlight.color : "rgba(255,255,255,0.92)");
    gradient.addColorStop(0.4, highlight ? highlight.color : "rgba(255,255,255,0.75)");
    gradient.addColorStop(1, highlight ? highlight.glow : "rgba(123, 216, 255, 0.1)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawSelection() {
  if (!selectedStar) {
    selectionStatus.textContent = visibleStars.length ? "No star selected" : "Loading stars...";
    return;
  }

  selectionStatus.innerHTML = `Selected: <strong>${selectionLabel(selectedStar)}</strong>`;

  const x = selectedStar.x * renderWidth;
  const y = selectedStar.y * renderHeight;
  const radius = starRadius(selectedStar.mag);

  ctx.save();
  ctx.strokeStyle = "rgba(244, 191, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function findStarAt(x, y) {
  for (let i = visibleStars.length - 1; i >= 0; i -= 1) {
    const star = visibleStars[i];
    const sx = star.x * renderWidth;
    const sy = star.y * renderHeight;
    const radius = starRadius(star.mag) + 6;
    const dx = x - sx;
    const dy = y - sy;
    if (Math.hypot(dx, dy) <= radius) {
      return star;
    }
  }
  return null;
}

function handleCanvasClick(event) {
  if (!visibleStars.length) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const star = findStarAt(x, y);
  if (!star) return;

  if (selectedStar && selectedStar.id !== star.id) {
    lines.push({ from: selectedStar.id, to: star.id });
  }

  selectedStar = star;
  draw();
}

function handleMouseMove(event) {
  if (!visibleStars.length || !hoverLabel) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const star = findStarAt(x, y);
  hoveredStar = star;
  updateHoverLabel(star, rect, x, y);
}

function handleMouseLeave() {
  hoveredStar = null;
  if (hoverLabel) hoverLabel.hidden = true;
}

function handleContextMenu(event) {
  event.preventDefault();
  if (!selectedStar) return;
  selectedStar = null;
  selectionStatus.textContent = "No star selected";
  draw();
}

function handleHemisphereChange(event) {
  currentHemisphere = event.target.value;
  selectedStar = null;
  selectionStatus.textContent = hemispheres[currentHemisphere].stars.length
    ? "No star selected"
    : "Loading stars...";
  draw();
}

function handleClearLines() {
  lines.length = 0;
  draw();
}

function selectionLabel(star) {
  if (star.properName) return star.properName;
  if (star.bayer) {
    return `${star.bayer}${star.constellation || ""}`;
  }
  if (star.constellation) {
    const hrLabel = star.hr ? `HR ${star.hr} ` : "";
    return `${hrLabel}${star.constellation}`.trim();
  }
  return star.hr ? `HR ${star.hr}` : star.name;
}

function setupCanvasSizing() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
}

function handleMagnitudeChange(event) {
  magnitudeLimit = parseFloat(event.target.value);
  if (Number.isFinite(magnitudeLimit)) {
    magnitudeValue.textContent = magnitudeLimit.toFixed(1);
    applyMagnitudeFilter();
  }
}

function openSaveModal() {
  saveModal.hidden = false;
  nameInput.value = "";
  nameInput.focus();
}

function closeSaveModal() {
  saveModal.hidden = true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

function downloadImage(title) {
  // Ensure latest render
  draw();
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.drawImage(canvas, 0, 0);

  // Overlay title text near bottom
  if (title) {
    exportCtx.save();
    exportCtx.fillStyle = "rgba(0,0,0,0.55)";
    exportCtx.fillRect(0, exportCanvas.height - 80, exportCanvas.width, 80);
    exportCtx.fillStyle = "#e9edf5";
    exportCtx.font = `bold ${Math.max(18, Math.round(24 * pixelRatio))}px "Inter", "Segoe UI", system-ui, sans-serif`;
    exportCtx.textAlign = "center";
    exportCtx.textBaseline = "middle";
    exportCtx.fillText(title, exportCanvas.width / 2, exportCanvas.height - 40);
    exportCtx.restore();
  }

  const dataUrl = exportCanvas.toDataURL("image/png");

  // iOS Safari doesn't honor download attribute on data URLs; open in a new tab instead
  if (isIOS()) {
    const win = window.open();
    if (win) {
      win.document.write(`<img src="${dataUrl}" style="width:100%;height:auto;">`);
    } else {
      // fallback: set location
      window.location.href = dataUrl;
    }
    return;
  }

  const link = document.createElement("a");
  link.download = `${title ? title.replace(/\\s+/g, "-").toLowerCase() : "constellation"}.png`;
  link.href = dataUrl;
  link.click();
}

function updateHoverLabel(star, rect, x, y) {
  if (!hoverLabel) return;
  if (!star) {
    hoverLabel.hidden = true;
    return;
  }
  hoverLabel.hidden = false;
  hoverLabel.textContent = selectionLabel(star);
  const labelWidth = hoverLabel.offsetWidth || 140;
  const labelHeight = hoverLabel.offsetHeight || 24;
  const padding = 12;
  const left = Math.min(rect.width - labelWidth - 8, Math.max(0, x + padding));
  const top = Math.min(rect.height - labelHeight - 8, Math.max(0, y + padding));
  hoverLabel.style.left = `${left}px`;
  hoverLabel.style.top = `${top}px`;
}

function init() {
  setupCanvasSizing();
  canvas.addEventListener("click", handleCanvasClick);
  canvas.addEventListener("mousemove", handleMouseMove);
  canvas.addEventListener("mouseleave", handleMouseLeave);
  canvas.addEventListener("contextmenu", handleContextMenu);
  clearLinesButton.addEventListener("click", handleClearLines);
  if (magnitudeSlider) {
    magnitudeSlider.addEventListener("input", handleMagnitudeChange);
    magnitudeValue.textContent = magnitudeLimit.toFixed(1);
  }
  if (saveButton) {
    saveButton.addEventListener("click", openSaveModal);
  }
  if (cancelSaveButton) {
    cancelSaveButton.addEventListener("click", closeSaveModal);
  }
  if (saveForm) {
    saveForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = nameInput.value.trim();
      closeSaveModal();
      downloadImage(title);
    });
  }
  loadBrightStars();
}

init();
