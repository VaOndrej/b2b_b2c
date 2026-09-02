/**
 * Flat SVG packaging — the product-image style for the Won demo.
 *
 * Replaces the raster CSS renders for PRODUCT shots. The rasters chase realism
 * with specular bands and contact shadows and land in the uncanny middle: not a
 * photograph, and not a confident illustration either. At product-card size
 * (~380px) none of that detail survives anyway — what reads is silhouette,
 * colour and the label.
 *
 * So these are deliberately flat: two tones per surface at most, no blur, no
 * noise, no soft shadow. That style is honest about being a drawing, stays
 * crisp at any size, and weighs ~2 kB instead of ~120 kB.
 *
 * Every function returns a complete standalone <svg> document string.
 *
 * NOTE ON USE: theme assets take the .svg directly. Shopify PRODUCT media does
 * not render SVG, so store uploads must go through a rasteriser
 * (render-images.mjs --from-svg) — the SVG stays the source of truth either way.
 */

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Shared type block on a white label plate. Sizes are in user units. */
/**
 * Shrink a font size until the string fits the plate. The label is set in one
 * fixed size, so a longer product name than the family was designed around
 * ("Ashwagandha" on a pouch) simply painted over the edge of the pack. Widths
 * are estimated from the glyph average of bold Helvetica — exact enough to keep
 * text inside the plate, and it returns `size` untouched whenever the string
 * already fits, so packs that were fine stay byte-identical.
 */
function fitFont(text, size, maxWidth, tracking = 0) {
  const width = (fs) => text.length * (fs * 0.58 + tracking);
  if (width(size) <= maxWidth) return size;
  return Math.max(size * 0.55, (maxWidth / text.length - tracking) / 0.58);
}

function labelPlate({ x, y, w, h, brand, name, sub, ink, accent, r = 6 }) {
  const cx = x + w / 2;
  const nameSize = fitFont(name, h * 0.23, w * 0.86);
  const subText = sub ? sub.toUpperCase() : '';
  const subSize = sub ? fitFont(subText, h * 0.1, w * 0.78, h * 0.02) : 0;
  return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#ffffff"/>
    <text x="${cx}" y="${y + h * 0.26}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
          font-size="${h * 0.13}" font-weight="700" letter-spacing="${h * 0.075}" fill="${ink}">${esc(brand)}</text>
    <rect x="${cx - w * 0.2}" y="${y + h * 0.35}" width="${w * 0.4}" height="${Math.max(1.5, h * 0.018)}" fill="${accent}"/>
    <text x="${cx}" y="${y + h * 0.61}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
          font-size="${nameSize}" font-weight="800" fill="${ink}">${esc(name)}</text>
    ${
      sub
        ? `<rect x="${cx - w * 0.28}" y="${y + h * 0.71}" width="${w * 0.56}" height="${h * 0.17}" rx="${h * 0.085}"
                 fill="${accent}" fill-opacity="0.14"/>
           <text x="${cx}" y="${y + h * 0.825}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
                 font-size="${subSize}" font-weight="700" letter-spacing="${h * 0.02}" fill="${accent}">${esc(subText)}</text>`
        : ''
    }
  </g>`;
}

/**
 * Flat shading = ONE darker band down the right quarter. That single edge is
 * what makes a rectangle read as a cylinder in flat illustration; adding more
 * tones starts imitating a render and loses the style.
 */
function shade(w, x, y, h, r, colorDark, frac = 0.26) {
  const sw = w * frac;
  return `<path d="M${x + w - sw},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r}
           V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + w - sw} Z" fill="${colorDark}"/>`;
}

const doc = (w, h, body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">` +
  (bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : '') +
  body +
  `</svg>`;

/** Screw-top tub. */
export function tubSvg({ w = 600, h = 700, body, cap, dark, accent, ink = '#14171c', brand = 'WON', name, sub, bg }) {
  const bw = w * 0.52, bx = (w - bw) / 2;
  const capH = h * 0.09, capW = bw * 1.06, capX = (w - capW) / 2;
  const by = h * 0.16, bh = h * 0.66;
  return doc(w, h, `
    <ellipse cx="${w / 2}" cy="${by + bh + h * 0.028}" rx="${bw * 0.46}" ry="${h * 0.016}" fill="${dark}" fill-opacity="0.16"/>
    <rect x="${capX}" y="${by - capH}" width="${capW}" height="${capH + 8}" rx="${w * 0.018}" fill="${cap}"/>
    ${shade(capW, capX, by - capH, capH + 8, w * 0.018, dark, 0.22)}
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${w * 0.04}" fill="${body}"/>
    ${shade(bw, bx, by, bh, w * 0.04, dark)}
    ${labelPlate({ x: bx + bw * 0.09, y: by + bh * 0.24, w: bw * 0.82, h: bh * 0.44, brand, name, sub, ink, accent })}
  `, bg);
}

/** Stand-up pouch: narrow, crimped fin, gusseted base. */
export function pouchSvg({ w = 600, h = 700, body, dark, accent, ink = '#14171c', brand = 'WON', name, sub, bg }) {
  const bw = w * 0.46, bx = (w - bw) / 2;
  const by = h * 0.15, bh = h * 0.68;
  const finW = bw * 0.5, finH = h * 0.035;
  return doc(w, h, `
    <ellipse cx="${w / 2}" cy="${by + bh + h * 0.028}" rx="${bw * 0.48}" ry="${h * 0.016}" fill="${dark}" fill-opacity="0.16"/>
    <rect x="${(w - finW) / 2}" y="${by - finH - 4}" width="${finW}" height="${finH}" rx="2" fill="${dark}"/>
    <path d="M${bx},${by + bh - bw * 0.18}
             V${by + bw * 0.1}
             L${bx + bw * 0.22},${by}
             H${bx + bw * 0.78}
             L${bx + bw},${by + bw * 0.1}
             V${by + bh - bw * 0.18}
             Q${bx + bw},${by + bh} ${bx + bw - bw * 0.18},${by + bh}
             H${bx + bw * 0.18}
             Q${bx},${by + bh} ${bx},${by + bh - bw * 0.18} Z" fill="${body}"/>
    <path d="M${bx + bw * 0.74},${by + bw * 0.02}
             L${bx + bw},${by + bw * 0.1}
             V${by + bh - bw * 0.18}
             Q${bx + bw},${by + bh} ${bx + bw - bw * 0.18},${by + bh}
             H${bx + bw * 0.74} Z" fill="${dark}"/>
    ${labelPlate({ x: bx + bw * 0.08, y: by + bh * 0.28, w: bw * 0.84, h: bh * 0.4, brand, name, sub, ink, accent })}
  `, bg);
}

/** Carton, drawn as a flat 3/4 box: front face + one darker side face. */
export function boxSvg({ w = 600, h = 700, body, dark, accent, ink = '#14171c', brand = 'WON', name, sub, bg }) {
  const fw = w * 0.44, fx = (w - fw) / 2 - w * 0.05;
  const by = h * 0.2, bh = h * 0.6;
  const side = fw * 0.26, rise = bh * 0.07;
  return doc(w, h, `
    <ellipse cx="${fx + (fw + side) / 2}" cy="${by + bh + h * 0.026}" rx="${fw * 0.6}" ry="${h * 0.015}" fill="${dark}" fill-opacity="0.16"/>
    <polygon points="${fx},${by + rise} ${fx + side},${by} ${fx + fw + side},${by} ${fx + fw},${by + rise}" fill="${body}" fill-opacity="0.75"/>
    <polygon points="${fx + fw},${by + rise} ${fx + fw + side},${by} ${fx + fw + side},${by + bh - rise} ${fx + fw},${by + bh}" fill="${dark}"/>
    <rect x="${fx}" y="${by + rise}" width="${fw}" height="${bh - rise}" fill="${body}"/>
    ${labelPlate({ x: fx + fw * 0.1, y: by + rise + (bh - rise) * 0.26, w: fw * 0.8, h: (bh - rise) * 0.42, brand, name, sub, ink, accent, r: 4 })}
  `, bg);
}

export const FORMS = { tub: tubSvg, pouch: pouchSvg, box: boxSvg };

/**
 * Composite scenes — hero / promo / lifestyle art built from the SAME flat packs.
 *
 * Necessary for coherence, not decoration: with glossy raster heroes above flat
 * vector product cards, one page shows two different ideas of what a Won pack
 * looks like. Whichever style wins, the page must only have one.
 *
 * The composition rules carry over from the raster pass (they were learned from
 * a live check, not from taste): the subject sits in the UPPER-RIGHT quadrant
 * because overlaid text is full-width on a phone and left-aligned on a desktop,
 * and the copy zone gets its own scrim.
 */
export function sceneSvg({
  w, h, bg, floor, packs, scrim = 'wide', label = '', glow = null,
}) {
  const defs = `
    <defs>
      <linearGradient id="sx" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity="0.42"/>
        <stop offset="0.42" stop-color="#000" stop-opacity="0.12"/>
        <stop offset="0.65" stop-color="#000" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="sy" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.4" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.42"/>
      </linearGradient>
      <radialGradient id="key">
        <stop offset="0" stop-color="#fff" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>`;

  // Each pack is its own <svg> document; nest them so their internal coordinate
  // systems stay independent of the scene's.
  const body = packs.map((p) => {
    const { form, x, y, scale = 1, opacity = 1, ...opts } = p;
    const pw = 600 * scale, ph = 700 * scale;
    const inner = FORMS[form]({ w: 600, h: 700, ...opts, bg: null });
    const nested = inner.replace(
      /^<svg[^>]*>/,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700" x="${x - pw / 2}" y="${y - ph}" width="${pw}" height="${ph}" opacity="${opacity}">`
    );
    return nested;
  }).join('');

  const scrims =
    scrim === 'none' ? '' :
    `<rect width="${w}" height="${h}" fill="url(#sx)"/><rect width="${w}" height="${h}" fill="url(#sy)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"${label ? ` aria-label="${esc(label)}"` : ''}>
    ${defs}
    <rect width="${w}" height="${h}" fill="${bg}"/>
    ${floor ? `<rect y="${floor.y}" width="${w}" height="${h - floor.y}" fill="${floor.fill}"/>` : ''}
    ${/* A dark pack on a dark ground has no silhouette — the label then reads as
          floating type rather than as something printed on a tub. One soft key
          behind the group restores separation without leaving the flat style. */''}
    ${glow ? `<ellipse cx="${glow.x}" cy="${glow.y}" rx="${glow.r}" ry="${glow.r * 0.8}" fill="url(#key)"/>` : ''}
    ${body}
    ${scrims}
  </svg>`;
}
