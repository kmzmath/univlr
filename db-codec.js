(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.DbCodec = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FORMAT = "univlr-db@2";
  const FORMATO_ANTERIOR = "univlr-db@1";

  // Formas especiais do nó. De 0 para cima, o número é o índice em `shapes`.
  const ARRAY = -1;
  const MAP = -2;
  const SET = -3;
  const DATE = -4;

  // Codifica o grafo do banco preservando referências compartilhadas e ciclos:
  // cada objeto vira um nó em `nodes` e as ocorrências viram [índice] - sem
  // isso, matches/matchSeries/ranking duplicariam centenas de MB.
  //
  // Nó é um array: a forma e depois os valores. Objetos com as mesmas chaves
  // apontam para a mesma linha de `shapes`, porque repetir o nome de cada campo
  // em cada atuação custava 30% do arquivo. Em valor, array é sempre marcador:
  // [i] referência, [] undefined, ["NaN"] número que o JSON não representa.
  function encode(value) {
    const nodes = [];
    const refs = new Map();
    const shapes = [];
    const shapeIndex = new Map();
    let droppedFunctions = 0;

    function shapeOf(keys) {
      const id = JSON.stringify(keys);
      if (!shapeIndex.has(id)) {
        shapeIndex.set(id, shapes.length);
        shapes.push(keys);
      }
      return shapeIndex.get(id);
    }

    function enc(item) {
      if (item === null) return null;
      const type = typeof item;
      if (type === "string" || type === "boolean") return item;
      if (type === "number") {
        return Number.isFinite(item) ? item : [String(item)];
      }
      if (type === "undefined") return [];
      if (type === "function") {
        droppedFunctions += 1;
        return null;
      }
      if (type !== "object") return null;
      if (refs.has(item)) return [refs.get(item)];
      const index = nodes.length;
      refs.set(item, index);
      nodes.push(null);
      let node;
      if (Array.isArray(item)) {
        node = [ARRAY, ...item.map(enc)];
      } else if (item instanceof Map) {
        node = [MAP];
        for (const [key, val] of item) node.push(enc(key), enc(val));
      } else if (item instanceof Set) {
        node = [SET, ...[...item].map(enc)];
      } else if (item instanceof Date) {
        node = [DATE, item.getTime()];
      } else {
        const keys = Object.keys(item);
        node = [shapeOf(keys), ...keys.map((key) => enc(item[key]))];
      }
      nodes[index] = node;
      return [index];
    }

    const encodedRoot = enc(value);
    return { format: FORMAT, root: encodedRoot, shapes, nodes, droppedFunctions };
  }

  function decodeAnterior(payload) {
    const nodes = payload.nodes || [];
    const shells = nodes.map((node) => {
      switch (node.$) {
        case "a":
          return [];
        case "m":
          return new Map();
        case "s":
          return new Set();
        case "d":
          return new Date(node.v);
        default:
          return {};
      }
    });

    function dec(item) {
      if (item === null || typeof item !== "object") return item;
      switch (item.$) {
        case "r":
          return shells[item.i];
        case "num":
          return Number(item.v);
        case "undef":
          return undefined;
        default:
          return item;
      }
    }

    nodes.forEach((node, index) => {
      const target = shells[index];
      if (node.$ === "a") {
        for (const item of node.v) target.push(dec(item));
      } else if (node.$ === "m") {
        for (const [key, val] of node.v) target.set(dec(key), dec(val));
      } else if (node.$ === "s") {
        for (const item of node.v) target.add(dec(item));
      } else if (node.$ === "o") {
        for (const key of Object.keys(node.v)) target[key] = dec(node.v[key]);
      }
    });

    return dec(payload.root);
  }

  function decode(payload) {
    if (payload?.format === FORMATO_ANTERIOR) return decodeAnterior(payload);
    if (!payload || payload.format !== FORMAT) {
      throw new Error("Formato de database.json não suportado");
    }
    const nodes = payload.nodes || [];
    const shapes = payload.shapes || [];
    const shells = nodes.map((node) => {
      switch (node[0]) {
        case ARRAY:
          return [];
        case MAP:
          return new Map();
        case SET:
          return new Set();
        case DATE:
          return new Date(node[1]);
        default:
          return {};
      }
    });

    function dec(item) {
      if (!Array.isArray(item)) return item;
      if (!item.length) return undefined;
      return typeof item[0] === "string" ? Number(item[0]) : shells[item[0]];
    }

    nodes.forEach((node, index) => {
      const target = shells[index];
      const form = node[0];
      if (form === ARRAY) {
        for (let i = 1; i < node.length; i += 1) target.push(dec(node[i]));
      } else if (form === MAP) {
        for (let i = 1; i < node.length; i += 2) target.set(dec(node[i]), dec(node[i + 1]));
      } else if (form === SET) {
        for (let i = 1; i < node.length; i += 1) target.add(dec(node[i]));
      } else if (form !== DATE) {
        const keys = shapes[form];
        for (let i = 0; i < keys.length; i += 1) target[keys[i]] = dec(node[i + 1]);
      }
    });

    return dec(payload.root);
  }

  return { FORMAT, encode, decode };
});
