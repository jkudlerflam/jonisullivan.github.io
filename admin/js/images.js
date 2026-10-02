/**
 * images.js: browser-side image preparation for the website editor.
 *
 * The artist drops photos of her paintings (often 2-6 MB JPEGs with embedded ICC color profiles)
 * into the editor, which uploads web-ready versions to the site repository. When a photo is already
 * web-sized we upload the original bytes untouched, so its color profile survives. Otherwise we
 * downscale by repeated halving and re-encode, as JPEG unless the image really has transparency.
 * The module also parses her "Title_Medium_Size_Year" filenames, builds captions and slugs, and
 * makes favicons. No dependencies. Targets current Chrome, Safari 16+ and Firefox.
 */

// ---------- File types and errors ----------

const EXT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
};
const TYPE_ALIASES = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/x-png': 'image/png' };
const ACCEPTED = new Set(Object.values(EXT_TYPES));
const KEEPABLE = new Set(['image/jpeg', 'image/png', 'image/webp']); // may be uploaded untouched
const MAY_HAVE_ALPHA = new Set(['image/png', 'image/webp', 'image/gif']);

const codedError = (code, message) => Object.assign(new Error(message), { code });

// The MIME type to treat the file as (file.type first, then the extension). Throws UNSUPPORTED_FORMAT.
function detectType(file) {
  const ext = (/\.([a-z0-9]+)$/i.exec(file?.name || '')?.[1] || '').toLowerCase();
  let type = String(file?.type || '').toLowerCase();
  type = TYPE_ALIASES[type] || type;
  if (!type || type === 'application/octet-stream') type = EXT_TYPES[ext] || '';
  if (ACCEPTED.has(type)) return type;
  // Name the format the way the artist knows it ("HEIC", "TIFF", "PSD").
  const label = (ext && !EXT_TYPES[ext] ? ext : (type.split('/')[1] || '').replace(/^x-|\+.*$/g, '')).toUpperCase();
  throw codedError('UNSUPPORTED_FORMAT',
    `This file type${label ? ` (${label})` : ''} can't be used on the web. Please export it as a JPEG first.`);
}

// ---------- Decoding ----------

// Decodes `file` with its EXIF orientation applied. Returns { image, width, height, release }, where
// `image` is anything drawImage accepts and release() frees it. Throws DECODE_FAILED.
async function decode(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // Browsers that reject the option (or the call) fall through to an <img>, which applies
    // EXIF orientation by default in every current browser.
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty image');
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw codedError('DECODE_FAILED', "This image couldn't be read. The file may be damaged, or saved in a "
      + "format this browser can't open. Please export it as a JPEG and try again.");
  }
}

// ---------- Canvas helpers ----------

// Use OffscreenCanvas only if it really provides a 2D context, otherwise fall back to <canvas>.
const OFFSCREEN = typeof OffscreenCanvas === 'function' && (() => {
  try { return !!new OffscreenCanvas(1, 1).getContext('2d'); } catch { return false; }
})();

function makeCanvas(width, height) {
  if (OFFSCREEN) return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw codedError('ENCODE_FAILED', 'This image is too large for the browser to resize.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

// Shrinking a canvas to 0x0 frees its pixel memory now rather than at garbage collection.
const freeCanvas = (canvas) => { canvas.width = 0; canvas.height = 0; };

function encode(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob)
    : reject(codedError('ENCODE_FAILED', 'The browser could not save the resized image.'))), type, quality));
}

// High-quality resize of the source rectangle [sx, sy, sw, sh] of `image` to w x h. We halve while the
// source is more than 2x the target, then make one final draw at the exact size. (A single large
// drawImage step would alias.) A `background` fills the final canvas first (white under JPEGs).
function resample(image, [sx, sy, sw, sh], w, h, background) {
  let source = image;
  let temp = null;
  try {
    while (sw > 2 * w && sh > 2 * h) {
      const half = makeCanvas(Math.round(sw / 2), Math.round(sh / 2));
      context2d(half).drawImage(source, sx, sy, sw, sh, 0, 0, half.width, half.height);
      if (temp) freeCanvas(temp);
      source = temp = half;
      [sx, sy, sw, sh] = [0, 0, half.width, half.height];
    }
    const out = makeCanvas(w, h);
    const ctx = context2d(out);
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
    return out;
  } finally {
    if (temp) freeCanvas(temp);
  }
}

async function render(src, w, h, type, quality, rect = [0, 0, src.width, src.height]) {
  const canvas = resample(src.image, rect, w, h, type === 'image/jpeg' ? '#fff' : null);
  try {
    return await encode(canvas, type, quality);
  } finally {
    freeCanvas(canvas);
  }
}

// True when the image really has transparency: any alpha < 250 in a copy at most 256 px on a side.
function hasTransparency(src) {
  const scale = Math.min(1, 256 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = makeCanvas(w, h);
  try {
    const ctx = context2d(canvas);
    ctx.drawImage(src.image, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
    return false;
  } finally {
    freeCanvas(canvas);
  }
}

// ---------- Public API ----------

/**
 * Prepares a dropped image for upload. Returns { width, height, type, keptOriginal, variants }, where
 * variants[0] is 'main' (at most maxEdge on the long edge) and, when main is wider than
 * mediumThreshold, variants[1] is a 'medium' copy mediumWidth wide. Errors carry a .code
 * ('UNSUPPORTED_FORMAT' or 'DECODE_FAILED') and a message that can be shown to the artist as is.
 */
export async function prepareImage(file, opts = {}) {
  const { maxEdge = 2500, keepOriginalBelowBytes = 2_500_000, quality = 0.86,
    mediumWidth = 1200, mediumThreshold = 1500 } = opts;
  const type = detectType(file);
  const src = await decode(file);
  try {
    const { width, height } = src;
    // Re-encoded variants are PNG only when transparency is really there. The check runs once and
    // lazily, because a kept original without a medium variant never needs it.
    let outType;
    const reencode = async (key, w, h) => {
      outType ??= (MAY_HAVE_ALPHA.has(type) && hasTransparency(src)) ? 'image/png' : 'image/jpeg';
      return { key, blob: await render(src, w, h, outType, quality), width: w, height: h, type: outType };
    };

    let main;
    if (Math.max(width, height) <= maxEdge && file.size <= keepOriginalBelowBytes && KEEPABLE.has(type)) {
      main = { key: 'main', blob: file, width, height, type };
    } else {
      const scale = Math.min(1, maxEdge / Math.max(width, height)); // never upscale
      main = await reencode('main', Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    }
    const variants = [main];
    if (main.width > mediumThreshold) {
      const w = Math.min(mediumWidth, width);
      variants.push(await reencode('medium', w, Math.max(1, Math.round((height * w) / width))));
    }
    return { width: main.width, height: main.height, type: main.type, keptOriginal: main.blob === file, variants };
  } finally {
    src.release();
  }
}

const SIZE_RE = /^\d+(\.\d+)?\s*[x×X]\s*\d+(\.\d+)?(\s*(in|inches|cm|"))?$/i;
const YEAR_RE = /^(19|20)\d\d$/;
const MARKER_RE = /^(web|webtext|final)$/i;
// Camera and phone names (IMG_0698, DSCF1234, PXL_2024..., Screenshot ..., 20240501_123456) have no title.
const CAMERA_RE = /^(?:img|dsc[fn]?|_dsc|pxl|mvimg|vid|pano|gopr|dji)[-_ ]?[a-z]?\d|^screen[-_ ]?shot|^whatsapp image|^\d{8}[-_]\d{6}/i;
// Extensions start with a letter, so "Study_8.5x11" keeps its size.
const stripExt = (name) => String(name ?? '').replace(/\.[a-z][a-z0-9]{0,4}$/i, '');

/** Parses the artist's "Title_Medium_Size_Year.ext" filenames into { title, medium, size, year }. */
export function parseArtworkFilename(name) {
  const out = { title: '', medium: '', size: '', year: '' };
  const stem = stripExt(name).trim();
  const fields = stem.split('_').map((f) => f.trim()).filter(Boolean);
  while (fields.length && MARKER_RE.test(fields[fields.length - 1])) fields.pop();

  // Structured name: Title_Medium(s)_Size[_Year]. The title comes first, so the size is searched from 1.
  const sizeAt = fields.findIndex((f, i) => i > 0 && SIZE_RE.test(f));
  if (fields.length >= 3 && sizeAt > 0) {
    const yearAt = fields.findLastIndex((f, i) => i > 0 && i !== sizeAt && YEAR_RE.test(f));
    out.title = fields[0];
    out.size = fields[sizeAt];
    out.year = yearAt > 0 ? fields[yearAt] : '';
    out.medium = fields.slice(1, sizeAt).filter((_, i) => i + 1 !== yearAt).join(', ');
    return out;
  }
  // Otherwise the name is a title written with underscores, or a camera name with no title at all.
  if (CAMERA_RE.test(stem)) return out;
  if (fields.length > 1 && /^\d+$/.test(fields[0])) fields.shift(); // an index prefix like "38_"
  out.title = fields.join(' ').replace(/\s+/g, ' ').trim();
  return out;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Caption HTML in the house style: "<em>Title</em>, 20x16 inches, chalk pastel and oil on canvas, 2025". */
export function captionFromArtwork(artwork) {
  const { title, medium, size, year } = artwork || {};
  const [t, m, s, y] = [title, medium, size, year].map((v) => String(v ?? '').trim());
  const parts = [];
  if (t) parts.push(`<em>${escapeHtml(t)}</em>`);
  if (s) parts.push(escapeHtml(/\d$/.test(s) ? `${s} inches` : s)); // a bare "20x16" is in inches
  if (m) parts.push(escapeHtml(m[0].toLowerCase() + m.slice(1)));
  if (y) parts.push(escapeHtml(y));
  return parts.join(', ');
}

// Letters that NFKD leaves alone but that have a natural ASCII spelling.
const FOLD = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', '×': 'x' };

/** URL- and file-safe slug: "cesarean-delivery-chalk-pastel-and-oil-on-canvas-20x16-2025". */
export function slugifyFilename(name) {
  let slug = stripExt(name).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[ßæœøłđðþ×]/g, (c) => FOLD[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > 60) {
    const cut = slug.lastIndexOf('-', 60); // end on a word boundary unless that loses too much
    slug = slug.slice(0, cut >= 30 ? cut : 60).replace(/-+$/, '');
  }
  return slug || 'image';
}

/** Base64 of a blob's bytes, without the "data:...;base64," prefix. Fine for blobs of 10 MB and more. */
export async function blobToBase64(blob) {
  if (!blob.size) return ''; // nothing to encode
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.lastIndexOf(',') + 1); // base64 itself never contains a comma
}

/** Favicons from a square center crop: { png32, png180 } (PNG Blobs, 32x32 and 180x180). */
export async function makeFavicons(file) {
  detectType(file);
  const src = await decode(file);
  try {
    const side = Math.min(src.width, src.height);
    const rect = [Math.floor((src.width - side) / 2), Math.floor((src.height - side) / 2), side, side];
    return {
      png32: await render(src, 32, 32, 'image/png', undefined, rect),
      png180: await render(src, 180, 180, 'image/png', undefined, rect),
    };
  } finally {
    src.release();
  }
}

/** Runs the filename, caption and slug examples. Returns { passed, failed, failures }. */
export function selfTest() {
  const failures = [];
  let passed = 0;
  const check = (label, got, want) => {
    const [g, w] = [JSON.stringify(got), JSON.stringify(want)];
    if (g === w) passed += 1;
    else failures.push(`${label}: got ${g}, expected ${w}`);
  };
  const A = (title, medium = '', size = '', year = '') => ({ title, medium, size, year });

  const cesarean = A('Cesarean Delivery', 'Chalk pastel and oil on canvas', '20x16', '2025');
  const parseCases = [
    ['Cesarean Delivery_Chalk pastel and oil on canvas_20x16_2025.jpg', cesarean],
    ['Floppy Hand, Post-op_Oil on panel_8x10_ 2025.jpg', A('Floppy Hand, Post-op', 'Oil on panel', '8x10', '2025')],
    ['Laboring with Pink Hospital Blanket_ Oil on panel_9x12_2025.jpg', A('Laboring with Pink Hospital Blanket', 'Oil on panel', '9x12', '2025')],
    ['Ari Cam (May 23, 2024)_Oil on canvas_7x5_2025.jpg', A('Ari Cam (May 23, 2024)', 'Oil on canvas', '7x5', '2025')],
    ['Day_Dog_4_WEB.jpg', A('Day Dog 4')],
    ['38_Irises_About_to_Bloom_WebTEXT.jpg', A('Irises About to Bloom')],
    ['IMG_0698.webp', A('')],
    ['Night Garden_Oil on linen_24x30.jpg', A('Night Garden', 'Oil on linen', '24x30')], // no year
    ['Pears_Oil on panel_8×10_2023.jpg', A('Pears', 'Oil on panel', '8×10', '2023')],
    ['Big Sky_Acrylic on canvas_24 x 36 in_2022.png', A('Big Sky', 'Acrylic on canvas', '24 x 36 in', '2022')],
    ['Tiny_Gouache_5.5x7.5 inches.JPEG', A('Tiny', 'Gouache', '5.5x7.5 inches')],
    ['Duo_Oil_Cold wax_10x10_2019_final_WEB.jpg', A('Duo', 'Oil, Cold wax', '10x10', '2019')],
    ['', A('')],
    ['1984.jpg', A('1984')], // a lone number is a title, not an index
    ['DSCF1234.JPG', A('')],
    ['PXL_20240501_123456789.jpg', A('')],
    ['Screenshot 2024-05-01 at 10.00.00.png', A('')],
    ['screenshot_2024.png', A('')],
  ];
  for (const [name, want] of parseCases) check(`parse "${name}"`, parseArtworkFilename(name), want);

  const captionCases = [
    [cesarean, '<em>Cesarean Delivery</em>, 20x16 inches, chalk pastel and oil on canvas, 2025'],
    [A('Big Sky', 'Acrylic on canvas', '24 x 36 in', '2022'), '<em>Big Sky</em>, 24 x 36 in, acrylic on canvas, 2022'],
    [A('Rue', 'Huile sur toile', '50x70cm'), '<em>Rue</em>, 50x70cm, huile sur toile'],
    [A('Fish & <Chips>', 'Oil'), '<em>Fish &amp; &lt;Chips&gt;</em>, oil'],
    [A('', '', '', '2025'), '2025'],
    [A(''), ''],
  ];
  for (const [art, want] of captionCases) check(`caption ${JSON.stringify(art)}`, captionFromArtwork(art), want);

  const slugCases = [
    ['Cesarean Delivery_Chalk pastel and oil on canvas_20x16_2025.jpg', 'cesarean-delivery-chalk-pastel-and-oil-on-canvas-20x16-2025'],
    ['Café Église_Huile sur toile_50x70cm_2024.jpg', 'cafe-eglise-huile-sur-toile-50x70cm-2024'],
    ['Pears_Oil on panel_8×10_2023.jpg', 'pears-oil-on-panel-8x10-2023'],
    ['Øresund Straße.png', 'oresund-strasse'],
    ['A very long title that keeps going and going_Oil and cold wax on birch panel_48x36_2024.jpg',
      'a-very-long-title-that-keeps-going-and-going-oil-and-cold'],
    ['', 'image'],
    ['___.png', 'image'],
  ];
  for (const [name, want] of slugCases) check(`slug "${name}"`, slugifyFilename(name), want);

  return { passed, failed: failures.length, failures };
}
