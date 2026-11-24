import { describe, expect, it } from 'vitest';
import { HttpError } from '../../middleware/error';
import { inspectImage } from './image';

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  bytes.writeUInt16BE(17, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function webp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32BE(22, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  bytes.writeUInt32BE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

describe('parser de cabeçalho de imagem', () => {
  it('lê dimensões de PNG, JPEG e WebP sem dependências externas', () => {
    expect(inspectImage(png(12, 34))).toEqual({ mime: 'image/png', width: 12, height: 34 });
    expect(inspectImage(jpeg(56, 78))).toEqual({ mime: 'image/jpeg', width: 56, height: 78 });
    expect(inspectImage(webp(90, 12))).toEqual({ mime: 'image/webp', width: 90, height: 12 });
  });

  it('lê WebP lossless (VP8L)', () => {
    const bytes = Buffer.alloc(25);
    bytes.write('RIFF', 0, 'ascii');
    bytes.writeUInt32BE(17, 4);
    bytes.write('WEBP', 8, 'ascii');
    bytes.write('VP8L', 12, 'ascii');
    bytes.writeUInt32BE(5, 16);
    bytes.set([0x2f, 0x07, 0xc0, 0x01, 0x00], 20);

    expect(inspectImage(bytes)).toEqual({ mime: 'image/webp', width: 8, height: 8 });
  });

  it('não impõe teto de bytes: isso é responsabilidade do serviço por kind', () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024);
    png(8, 8).copy(bytes, 0);

    expect(inspectImage(bytes)).toEqual({ mime: 'image/png', width: 8, height: 8 });
  });

  it('rejeita magic bytes inválidos e imagens truncadas', () => {
    expect(() => inspectImage(Buffer.alloc(32))).toThrow(HttpError);
    expect(() => inspectImage(Buffer.from([0xff, 0xd8, 0xff]))).toThrow(HttpError);
  });

  it('limita dimensão e megapixels', () => {
    expect(() => inspectImage(png(1601, 1))).toThrow(HttpError);
    expect(() => inspectImage(png(1500, 1500))).not.toThrow();
    expect(() => inspectImage(png(1600, 1600))).toThrow(HttpError);
  });
});
