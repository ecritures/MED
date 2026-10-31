// Location map built from OpenStreetMap tiles.
// Used in two places: by scripts/render.mjs when the site is built (the map then works
// without JavaScript), and in the browser for the zoom buttons.

const EARTH = 40075016.686; // metres around the equator
export const MIN_KM = 2;
export const MAX_KM = 1600;
const STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];

/** Tiles and scale bar for a frame that shows `widthKm` kilometres from left to right. */
export function mapLayer(lat, lon, widthKm) {
  const rad = (lat * Math.PI) / 180;
  const tileMetres = (z) => (EARTH * Math.cos(rad)) / 2 ** z;
  // Pick the zoom level where 2–4 tiles span the frame, so tiles are shown at or below their native size.
  let zoom = 1;
  while (zoom < 18 && (widthKm * 1000) / tileMetres(zoom + 1) < 4) zoom++;
  const across = (widthKm * 1000) / tileMetres(zoom);
  const tw = 100 / across; // one tile, in container-width units (cqw)
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const half = Math.ceil(across / 2) + 1;
  const tiles = [];
  for (let ty = Math.floor(y) - half; ty <= Math.floor(y) + half; ty++)
    for (let tx = Math.floor(x) - half; tx <= Math.floor(x) + half; tx++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      tiles.push(`<img src="https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png" alt="" loading="lazy" style="left:${((tx - x) * tw).toFixed(3)}cqw;top:${((ty - y) * tw).toFixed(3)}cqw;width:${tw.toFixed(3)}cqw;height:${tw.toFixed(3)}cqw">`);
    }
  // Scale bar: a round distance close to a quarter of the frame width.
  const barKm = STEPS.reduce((best, v) => (Math.abs(v - widthKm / 4) < Math.abs(best - widthKm / 4) ? v : best));
  return {
    zoom,
    tiles: tiles.join(""),
    barLabel: barKm < 1 ? `${barKm * 1000} m` : `${barKm} km`,
    barWidth: `${((barKm / widthKm) * 100).toFixed(2)}%`,
  };
}

// ---------- Zoom buttons (browser only) ----------
if (typeof document !== "undefined") {
  for (const frame of document.querySelectorAll(".h-map-frame[data-lat]")) {
    const lat = Number(frame.dataset.lat), lon = Number(frame.dataset.lon);
    let km = Number(frame.dataset.km);
    const tilesEl = frame.querySelector(".h-map-tiles");
    const scaleEl = frame.querySelector(".h-scale");
    const zoomIn = frame.querySelector('[data-zoom="in"]');
    const zoomOut = frame.querySelector('[data-zoom="out"]');
    const draw = () => {
      const layer = mapLayer(lat, lon, km);
      tilesEl.innerHTML = layer.tiles;
      scaleEl.textContent = layer.barLabel;
      scaleEl.style.width = layer.barWidth;
      zoomIn.disabled = km / 2 < MIN_KM;
      zoomOut.disabled = km * 2 > MAX_KM;
    };
    zoomIn.addEventListener("click", () => { if (km / 2 >= MIN_KM) { km /= 2; draw(); } });
    zoomOut.addEventListener("click", () => { if (km * 2 <= MAX_KM) { km *= 2; draw(); } });
    frame.querySelector(".h-zoom").hidden = false;
    draw();
  }
}
