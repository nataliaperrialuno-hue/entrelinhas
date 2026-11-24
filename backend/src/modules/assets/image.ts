import { HttpError } from '../../middleware/error';

export interface ImageInfo {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

export const MAX_IMAGE_DIMENSION = 1600;
export const MAX_IMAGE_PIXELS = 2_500_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function invalid(): never {
  throw new HttpError(400, 'Imagem inválida.');
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function parsePng(buf: Buffer): ImageInfo {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return invalid();
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    return invalid();
  }

  return {
    mime: 'image/png',
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function parseJpeg(buf: Buffer): ImageInfo {
  let offset = 2; // SOI (FF D8)

  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let marker = buf[offset + 1];
    while (marker === 0xff && offset + 2 < buf.length) {
      offset += 1;
      marker = buf[offset + 1];
    }

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const length = buf.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buf.length) {
      return invalid();
    }

    if (SOF_MARKERS.has(marker)) {
      if (length < 7) {
        return invalid();
      }

      return {
        mime: 'image/jpeg',
        width: buf.readUInt16BE(offset + 7),
        height: buf.readUInt16BE(offset + 5),
      };
    }

    offset += 2 + length;
  }

  return invalid();
}

function parseWebp(buf: Buffer): ImageInfo {
  if (
    buf.length < 20 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return invalid();
  }

  const chunk = buf.toString('ascii', 12, 16);

  if (chunk === 'VP8X') {
    if (buf.length < 30) {
      return invalid();
    }

    return {
      mime: 'image/webp',
      width: buf.readUIntLE(24, 3) + 1,
      height: buf.readUIntLE(27, 3) + 1,
    };
  }

  if (chunk === 'VP8 ') {
    if (
      buf.length < 30 ||
      buf[23] !== 0x9d ||
      buf[24] !== 0x01 ||
      buf[25] !== 0x2a
    ) {
      return invalid();
    }

    return {
      mime: 'image/webp',
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === 'VP8L') {
    if (buf.length < 25 || buf[20] !== 0x2f) {
      return invalid();
    }

    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];

    return {
      mime: 'image/webp',
      width: 1 + (b0 | ((b1 & 0x3f) << 8)),
      height: 1 + ((b1 >>> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    };
  }

  return invalid();
}

/**
 * Verifica magic bytes e dimensões do cabeçalho. Limites de bytes por `kind`
 * (foto 2 MiB / selo 16 KiB) são autoridade do serviço, não deste parser.
 */
export function inspectImage(bytes: Uint8Array): ImageInfo {
  const buf = asBuffer(bytes);
  let info: ImageInfo;

  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    info = parsePng(buf);
  } else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    info = parseJpeg(buf);
  } else {
    info = parseWebp(buf);
  }

  if (
    !Number.isSafeInteger(info.width) ||
    !Number.isSafeInteger(info.height) ||
    info.width < 1 ||
    info.height < 1 ||
    info.width > MAX_IMAGE_DIMENSION ||
    info.height > MAX_IMAGE_DIMENSION ||
    info.width * info.height > MAX_IMAGE_PIXELS
  ) {
    return invalid();
  }

  return info;
}
