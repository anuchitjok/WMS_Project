/**
 * Logo validation by CONTENT, not by the browser-supplied type or file name.
 * Only PNG and JPEG are accepted (SVG can carry script, so it is refused).
 * Dimensions are read from the image header; the image is never decoded on
 * the server, it is only stored and served back as the same bytes.
 */
export const LOGO_MAX_BYTES = 1024 * 1024; // 1 MB
export const LOGO_MIN_SHORT_SIDE = 32;
export const LOGO_MIN_LONG_SIDE = 150; // enough to stay sharp at print size
export const LOGO_MAX_SIDE = 5000;
export const LOGO_MAX_RATIO = 10; // e.g. 2000 × 200 is fine, 3000 × 100 is not

export interface LogoInfo {
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(b: Buffer): { width: number; height: number } | null {
  // Signature, then the first chunk must be IHDR: length(4) type(4) width(4) height(4)
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG_SIG)) return null;
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null; // lost sync: not a well-formed JPEG
    while (b[i] === 0xff && i < b.length) i++; // fill bytes
    const marker = b[i];
    i++;
    // Stand-alone markers have no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // end / scan before any frame header
    if (i + 1 >= b.length) return null;
    const len = b.readUInt16BE(i);
    if (len < 2) return null;
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (i + 6 >= b.length) return null;
      return { height: b.readUInt16BE(i + 3), width: b.readUInt16BE(i + 5) };
    }
    i += len;
  }
  return null;
}

/** Returns the logo's type and size, or the reason it is refused. */
export function inspectLogo(b: Buffer): LogoInfo | { error: string } {
  if (!b?.length) return { error: 'The file is empty' };
  if (b.length > LOGO_MAX_BYTES)
    return { error: 'The logo must be 1 MB or smaller' };
  const png = pngSize(b);
  const jpg = png ? null : jpegSize(b);
  const size = png ?? jpg;
  if (!size)
    return {
      error: 'Only PNG or JPEG images are accepted (the file content is not a valid PNG or JPEG)',
    };
  const { width, height } = size;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < LOGO_MIN_SHORT_SIDE || long < LOGO_MIN_LONG_SIDE)
    return {
      error: `The logo is too small (${width} × ${height} px). Use at least ${LOGO_MIN_LONG_SIDE} px on the long side and ${LOGO_MIN_SHORT_SIDE} px on the short side so it prints sharply.`,
    };
  if (long > LOGO_MAX_SIDE)
    return { error: `The logo is too large (${width} × ${height} px). Use at most ${LOGO_MAX_SIDE} px per side.` };
  if (long / short > LOGO_MAX_RATIO)
    return { error: `The logo is too narrow (${width} × ${height} px). Its sides may differ by at most ${LOGO_MAX_RATIO}:1.` };
  return { mime: png ? 'image/png' : 'image/jpeg', width, height };
}
