// No Windows, abrir um arquivo para gravar logo depois de ele ser lido ou gravado
// às vezes falha por uma fração de segundo (UNKNOWN no Node, Errno 22 no Python).
// Medido em 31/10/2026: libera em 200 ms. A falha é na abertura, então o arquivo
// continua inteiro e basta tentar de novo. Outros erros sobem na hora.
const fs = require("fs");

const TENTATIVAS = 15;
const ESPERA_MS = 200;
const ERROS_PASSAGEIROS = new Set(["UNKNOWN", "EBUSY", "EPERM", "EACCES"]);

function writeFileWithRetry(file, ...args) {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return fs.writeFileSync(file, ...args);
    } catch (error) {
      if (tentativa >= TENTATIVAS || !ERROS_PASSAGEIROS.has(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ESPERA_MS);
    }
  }
}

module.exports = { writeFileWithRetry };
