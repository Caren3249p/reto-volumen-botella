/**
 * integracion.js
 * Métodos de integración numérica para el volumen de una botella
 * (sólido de revolución):  V = π ∫ r(z)² dz
 *
 * Entrada: dos arreglos del mismo tamaño
 *   z[i] -> altura del nodo i (cm), en orden creciente
 *   r[i] -> radio de la botella a esa altura (cm)
 * Salida: volumen en cm³ (= mL)
 *
 * Simpson necesita nodos IGUALMENTE espaciados. Si tu dataset no lo está,
 * usa primero resamplear(z, r, n).
 */
const Integracion = (() => {
  const TOL = 1e-6;

  // f(z) = π r²  (área de cada disco)
  const areas = (r) => r.map((x) => Math.PI * x * x);

  function esUniforme(z) {
    if (z.length < 3) return true;
    const h = z[1] - z[0];
    return z.every((v, i) => i === 0 || Math.abs(v - z[i - 1] - h) < TOL * Math.max(1, Math.abs(h)));
  }

  // ---------- Trapecio compuesto (sirve con espaciado no uniforme) ----------
  function trapecio(z, r) {
    const f = areas(r);
    let s = 0;
    for (let i = 0; i < z.length - 1; i++) {
      s += ((f[i] + f[i + 1]) / 2) * (z[i + 1] - z[i]);
    }
    return { valor: s, aplicable: true, nota: "Trapecio compuesto" };
  }

  // ---------- Simpson 1/3 compuesto: n (nº de tramos) debe ser PAR ----------
  function simpson13(z, r) {
    const n = z.length - 1;
    if (!esUniforme(z)) return noAplica("Nodos no equiespaciados (usa resamplear)");
    if (n < 2 || n % 2 !== 0) return noAplica(`n = ${n} tramos: debe ser par`);
    const f = areas(r);
    const h = (z[n] - z[0]) / n;
    let s = f[0] + f[n];
    for (let i = 1; i < n; i++) s += (i % 2 === 0 ? 2 : 4) * f[i];
    return { valor: (h / 3) * s, aplicable: true, nota: "Simpson 1/3 compuesto" };
  }

  // ---------- Simpson 3/8 compuesto: n debe ser MÚLTIPLO DE 3 ----------
  function simpson38(z, r) {
    const n = z.length - 1;
    if (!esUniforme(z)) return noAplica("Nodos no equiespaciados (usa resamplear)");
    if (n < 3 || n % 3 !== 0) return noAplica(`n = ${n} tramos: debe ser múltiplo de 3`);
    const f = areas(r);
    const h = (z[n] - z[0]) / n;
    let s = f[0] + f[n];
    for (let i = 1; i < n; i++) s += (i % 3 === 0 ? 2 : 3) * f[i];
    return { valor: ((3 * h) / 8) * s, aplicable: true, nota: "Simpson 3/8 compuesto" };
  }

  // ---------- Simpson combinado: sirve para cualquier n >= 2 ----------
  // n par   -> todo con 1/3
  // n impar -> 1/3 en los primeros n-3 tramos y 3/8 en los últimos 3
  function simpsonCombinado(z, r) {
    const n = z.length - 1;
    if (!esUniforme(z)) return noAplica("Nodos no equiespaciados (usa resamplear)");
    if (n < 2) return noAplica("Se necesitan al menos 2 tramos");
    if (n % 2 === 0) return { ...simpson13(z, r), nota: "Simpson 1/3 (n par)" };
    if (n < 3) return noAplica("n impar < 3");
    const k = n - 3; // tramos para 1/3 (par)
    let total = 0;
    if (k >= 2) total += simpson13(z.slice(0, k + 1), r.slice(0, k + 1)).valor;
    total += simpson38(z.slice(k), r.slice(k)).valor;
    return { valor: total, aplicable: true, nota: "Simpson 1/3 + 3/8 (n impar)" };
  }

  function noAplica(motivo) {
    return { valor: NaN, aplicable: false, nota: motivo };
  }

  // ---------- Remuestreo a malla uniforme (interpolación lineal de r) ----------
  // Recomendado: n múltiplo de 6 -> aplican a la vez Simpson 1/3 y 3/8.
  function resamplear(z, r, n = 12) {
    const z0 = z[0];
    const z1 = z[z.length - 1];
    const zn = [];
    const rn = [];
    for (let i = 0; i <= n; i++) {
      const zi = z0 + ((z1 - z0) * i) / n;
      zn.push(zi);
      rn.push(interpolarRadio(z, r, zi));
    }
    return { z: zn, r: rn };
  }

  function interpolarRadio(z, r, x) {
    if (x <= z[0]) return r[0];
    if (x >= z[z.length - 1]) return r[r.length - 1];
    let j = 0;
    while (z[j + 1] < x) j++;
    const t = (x - z[j]) / (z[j + 1] - z[j]);
    return r[j] + t * (r[j + 1] - r[j]);
  }

  // ---------- Volumen acumulado hasta la altura h (para los métodos de raíces) ----------
  // V(h) = π ∫_{z0}^{h} r(z)² dz  con r(z) lineal a tramos (integral exacta por tramo).
  // Úsala así:  f(h) = Integracion.volumenHasta(z, r, h) - volumenObjetivo
  function volumenHasta(z, r, h) {
    let v = 0;
    for (let i = 0; i < z.length - 1; i++) {
      if (h <= z[i]) break;
      const a = z[i];
      const b = Math.min(h, z[i + 1]);
      const ra = r[i];
      const rb = interpolarRadio(z, r, b);
      // ∫ (ra + m t)² dt exacta en el tramo [a,b], m = pendiente
      const L = b - a;
      v += Math.PI * L * (ra * ra + ra * rb + rb * rb) / 3;
    }
    return v;
  }

  // ---------- Tabla comparativa para mostrar en la app ----------
  function comparar(z, r) {
    const t = trapecio(z, r);
    const s13 = simpson13(z, r);
    const s38 = simpson38(z, r);
    const filas = [
      { metodo: "Trapecio", ...t },
      { metodo: "Simpson 1/3", ...s13 },
      { metodo: "Simpson 3/8", ...s38 },
    ];
    // Diferencia relativa respecto a Simpson (referencia) cuando aplica
    const ref = s13.aplicable ? s13.valor : s38.aplicable ? s38.valor : t.valor;
    filas.forEach((f) => {
      f.difRel = f.aplicable && ref !== 0 ? Math.abs(f.valor - ref) / ref : NaN;
    });
    return filas;
  }

  return { trapecio, simpson13, simpson38, simpsonCombinado, resamplear, volumenHasta, comparar, esUniforme };
})();

// Para pruebas en Node (no afecta al navegador)
if (typeof module !== "undefined") module.exports = Integracion;