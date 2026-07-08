(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.DbCodec = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FORMAT = "univlr-db@1";

  // Codifica o grafo do banco preservando referências compartilhadas e ciclos:
  // cada objeto vira um nó em `nodes` e as ocorrências viram { $: "r", i } —
  // sem isso, matches/matchSeries/ranking duplicariam centenas de MB.
  function encode(value) {
    const nodes = [];
    const refs = new Map();
    let droppedFunctions = 0;

    function enc(item) {
      if (item === null) return null;
      const type = typeof item;
      if (type === "string" || type === "boolean") return item;
      if (type === "number") {
        return Number.isFinite(item) ? item : { $: "num", v: String(item) };
      }
      if (type === "undefined") return { $: "undef" };
      if (type === "function") {
        droppedFunctions += 1;
        return null;
      }
      if (type !== "object") return null;
      if (refs.has(item)) return { $: "r", i: refs.get(item) };
      const index = nodes.length;
      refs.set(item, index);
      nodes.push(null);
      let node;
      if (Array.isArray(item)) {
        node = { $: "a", v: item.map(enc) };
      } else if (item instanceof Map) {
        node = { $: "m", v: [...item.entries()].map(([key, val]) => [enc(key), enc(val)]) };
      } else if (item instanceof Set) {
        node = { $: "s", v: [...item].map(enc) };
      } else if (item instanceof Date) {
        node = { $: "d", v: item.getTime() };
      } else {
        const plain = {};
        for (const key of Object.keys(item)) plain[key] = enc(item[key]);
        node = { $: "o", v: plain };
      }
      nodes[index] = node;
      return { $: "r", i: index };
    }

    const encodedRoot = enc(value);
    return { format: FORMAT, root: encodedRoot, nodes, droppedFunctions };
  }

  function decode(payload) {
    if (!payload || payload.format !== FORMAT) {
      throw new Error("Formato de database.json não suportado");
    }
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

  return { FORMAT, encode, decode };
});
