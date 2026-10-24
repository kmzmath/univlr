/* zip.js - monta um .zip sem compressão (método STORE) no navegador.
 * PNG já é comprimido; guardar sem recomprimir deixa o zip rápido e simples.
 *
 *   const zip = new Zip();
 *   zip.adicionar("pasta/arquivo.png", uint8array);
 *   const blob = zip.gerar();
 */
(function (global) {
  "use strict";

  const TABELA = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dataDos(d) {
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { hora, dia };
  }

  class Zip {
    constructor() {
      this.arquivos = [];
    }

    adicionar(nome, bytes) {
      const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      this.arquivos.push({ nome: new TextEncoder().encode(nome), dados, crc: crc32(dados) });
    }

    gerar() {
      const { hora, dia } = dataDos(new Date());
      const partes = [];
      const central = [];
      let deslocamento = 0;
      for (const a of this.arquivos) {
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // nomes em UTF-8
        local.setUint16(8, 0, true); // STORE
        local.setUint16(10, hora, true);
        local.setUint16(12, dia, true);
        local.setUint32(14, a.crc, true);
        local.setUint32(18, a.dados.length, true);
        local.setUint32(22, a.dados.length, true);
        local.setUint16(26, a.nome.length, true);
        local.setUint16(28, 0, true);
        partes.push(local.buffer, a.nome, a.dados);

        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true);
        c.setUint16(10, 0, true);
        c.setUint16(12, hora, true);
        c.setUint16(14, dia, true);
        c.setUint32(16, a.crc, true);
        c.setUint32(20, a.dados.length, true);
        c.setUint32(24, a.dados.length, true);
        c.setUint16(28, a.nome.length, true);
        c.setUint16(30, 0, true);
        c.setUint16(32, 0, true);
        c.setUint16(34, 0, true);
        c.setUint16(36, 0, true);
        c.setUint32(38, 0, true);
        c.setUint32(42, deslocamento, true);
        central.push(c.buffer, a.nome);

        deslocamento += 30 + a.nome.length + a.dados.length;
      }
      const tamanhoCentral = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
      const fim = new DataView(new ArrayBuffer(22));
      fim.setUint32(0, 0x06054b50, true);
      fim.setUint16(8, this.arquivos.length, true);
      fim.setUint16(10, this.arquivos.length, true);
      fim.setUint32(12, tamanhoCentral, true);
      fim.setUint32(16, deslocamento, true);
      return new Blob([...partes, ...central, fim.buffer], { type: "application/zip" });
    }
  }

  global.Zip = Zip;
})(typeof window !== "undefined" ? window : globalThis);
