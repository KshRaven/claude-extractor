// Minimal store-only (no compression) ZIP writer. No dependencies.
(() => {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    T[n] = c >>> 0;
  }
  const crc32 = (u8) => {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = T[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const enc = new TextEncoder();
  const dos = (d) => ({
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  });

  class Zip {
    constructor() { this.files = []; }
    add(path, data, date = new Date()) {
      const u8 = typeof data === 'string' ? enc.encode(data) : data;
      this.files.push({ name: enc.encode(path), data: u8, crc: crc32(u8), ...dos(date) });
    }
    blob() {
      const parts = [], central = [];
      let off = 0;
      for (const f of this.files) {
        const len = f.data.length, nl = f.name.length;
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
        h.setUint16(10, f.time, true); h.setUint16(12, f.date, true); h.setUint32(14, f.crc, true);
        h.setUint32(18, len, true); h.setUint32(22, len, true); h.setUint16(26, nl, true);
        parts.push(h.buffer, f.name, f.data);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true); c.setUint16(12, f.time, true); c.setUint16(14, f.date, true);
        c.setUint32(16, f.crc, true); c.setUint32(20, len, true); c.setUint32(24, len, true);
        c.setUint16(28, nl, true); c.setUint32(42, off, true);
        central.push(c.buffer, f.name);
        off += 30 + nl + len;
      }
      const csize = central.reduce((a, b) => a + b.byteLength, 0);
      const e = new DataView(new ArrayBuffer(22));
      e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.files.length, true);
      e.setUint16(10, this.files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
      return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
    }
  }
  self.CX = self.CX || {};
  self.CX.Zip = Zip;
})();
