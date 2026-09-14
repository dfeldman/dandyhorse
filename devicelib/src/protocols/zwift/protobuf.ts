/** The few protobuf primitives the Zwift protocol needs. Hand-rolled to avoid a dependency. */

export function encodeVarint(n: number): number[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`varint must be a non-negative integer: ${n}`);
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}

export function decodeVarint(d: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let mul = 1;
  let i = offset;
  for (;;) {
    if (i >= d.length) throw new RangeError('truncated varint');
    const b = d[i++]!;
    value += (b & 0x7f) * mul;
    if (!(b & 0x80)) break;
    mul *= 0x80;
  }
  return { value, next: i };
}

export const zigzag = (n: number): number => (n >= 0 ? n * 2 : -n * 2 - 1);
export const unzigzag = (z: number): number => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

export interface PbField {
  field: number;
  wire: number;
  /** Varint value (wire 0), or raw bytes (wire 2). Fixed-width fields are returned as bytes. */
  value: number | Uint8Array;
}

export function decodeMessage(d: Uint8Array): PbField[] {
  const out: PbField[] = [];
  let i = 0;
  while (i < d.length) {
    const key = decodeVarint(d, i);
    i = key.next;
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (wire === 0) {
      const v = decodeVarint(d, i);
      i = v.next;
      out.push({ field, wire, value: v.value });
    } else if (wire === 2) {
      const len = decodeVarint(d, i);
      i = len.next;
      out.push({ field, wire, value: d.slice(i, i + len.value) });
      i += len.value;
    } else if (wire === 1 || wire === 5) {
      const n = wire === 1 ? 8 : 4;
      out.push({ field, wire, value: d.slice(i, i + n) });
      i += n;
    } else {
      throw new RangeError(`unsupported protobuf wire type ${wire}`);
    }
  }
  return out;
}

export class PbWriter {
  #buf: number[] = [];

  varint(field: number, n: number): this {
    this.#buf.push(...encodeVarint(field * 8), ...encodeVarint(Math.round(n)));
    return this;
  }

  sint(field: number, n: number): this {
    return this.varint(field, zigzag(Math.round(n)));
  }

  bytes(field: number, data: Uint8Array | number[]): this {
    this.#buf.push(...encodeVarint(field * 8 + 2), ...encodeVarint(data.length), ...data);
    return this;
  }

  message(field: number, inner: PbWriter): this {
    return this.bytes(field, inner.toBytes());
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.#buf);
  }
}
