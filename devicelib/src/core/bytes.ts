/** Byte helpers shared by every protocol codec. Pure functions, no platform dependencies. */

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Parse "55 aa 01", "55aa01" or "55:AA:01" into bytes. */
export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error(`odd-length hex string: ${text}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values.map((v) => v & 0xff));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function startsWithBytes(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

/** Sequential little-endian reader. Reads past the end throw, so parsers fail loudly on short frames. */
export class ByteReader {
  readonly data: Uint8Array;
  offset: number;

  constructor(data: Uint8Array, offset = 0) {
    this.data = data;
    this.offset = offset;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  #need(n: number): void {
    if (this.offset + n > this.data.length) {
      throw new RangeError(`frame too short: need ${n} bytes at offset ${this.offset}, have ${this.data.length}`);
    }
  }

  u8(): number {
    this.#need(1);
    return this.data[this.offset++]!;
  }

  s8(): number {
    const v = this.u8();
    return v > 0x7f ? v - 0x100 : v;
  }

  u16(): number {
    this.#need(2);
    const v = this.data[this.offset]! | (this.data[this.offset + 1]! << 8);
    this.offset += 2;
    return v;
  }

  s16(): number {
    const v = this.u16();
    return v > 0x7fff ? v - 0x10000 : v;
  }

  u24(): number {
    this.#need(3);
    const d = this.data;
    const o = this.offset;
    this.offset += 3;
    return d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16);
  }

  u32(): number {
    this.#need(4);
    const d = this.data;
    const o = this.offset;
    this.offset += 4;
    return (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16)) + d[o + 3]! * 0x1000000;
  }

  skip(n: number): void {
    this.#need(n);
    this.offset += n;
  }

  take(n: number): Uint8Array {
    this.#need(n);
    const out = this.data.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
}

/** Little-endian writer that grows as needed. */
export class ByteWriter {
  #buf: number[] = [];

  u8(v: number): this {
    this.#buf.push(v & 0xff);
    return this;
  }

  u16(v: number): this {
    const n = Math.round(v) & 0xffff;
    this.#buf.push(n & 0xff, n >> 8);
    return this;
  }

  s16(v: number): this {
    return this.u16(clampInt(Math.round(v), -0x8000, 0x7fff) & 0xffff);
  }

  u24(v: number): this {
    const n = Math.round(v);
    this.#buf.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff);
    return this;
  }

  raw(data: Uint8Array | number[]): this {
    for (const b of data) this.#buf.push(b & 0xff);
    return this;
  }

  get length(): number {
    return this.#buf.length;
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.#buf);
  }
}

export function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Round to the nearest multiple of step (step 0 or less leaves the value alone). */
export function roundToStep(v: number, step: number): number {
  if (!(step > 0)) return v;
  return Math.round(v / step) * step;
}

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final xor. */
export function crc16CcittFalse(data: Uint8Array, init = 0xffff): number {
  let crc = init;
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** Sum of bytes modulo 256 (common in vendor protocols). */
export function sum8(data: Uint8Array): number {
  let s = 0;
  for (const b of data) s = (s + b) & 0xff;
  return s;
}

/** XOR of bytes (ANT FE-C and several vendor protocols). */
export function xor8(data: Uint8Array): number {
  let s = 0;
  for (const b of data) s ^= b;
  return s;
}
