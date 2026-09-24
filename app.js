/* =====================================================================
   Reto Volumen Botella — app.js
   ---------------------------------------------------------------------
   Idea general
   1. Se toma una foto de la botella (de lado, fondo liso).
   2. Se segmenta la silueta y se mide el ancho de la botella fila por fila.
      Con la altura real (cm) se pasa de píxeles a cm  ->  perfil r(z).
   3. Volumen total por el método de los discos:  V = π ∫ r(z)² dz
   4. Volumen objetivo: se busca la altura h del nivel de líquido tal que
          f(h) = V(h) − V_objetivo = 0,   V(h) = π ∫₀ʰ r(z)² dz
      y esa raíz se calcula con los 5 métodos pedidos:
      bisección, falsa posición, Newton-Raphson, secante y punto fijo.
   5. Todo se dibuja encima de la foto (silueta, discos, nivel de líquido).
   ===================================================================== */
(function () {
  'use strict';

  /* ================= 1. SEGMENTACIÓN DE LA SILUETA ================= */

  // Desenfoque de caja separable (reduce ruido antes de umbralizar)
  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const k = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          s += src[y * W + xx];
        }
        tmp[y * W + x] = s / k;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.min(H - 1, Math.max(0, y + dy));
          s += tmp[yy * W + x];
        }
        out[y * W + x] = s / k;
      }
    }
    return out;
  }

  /**
   * Segmenta la botella comparando cada píxel con el color de fondo
   * (mediana de los bordes de la imagen). Se queda con la componente
   * conexa más grande y guarda, por fila, el borde izquierdo y derecho.
   * data = RGBA (Uint8ClampedArray de un ImageData)
   */
  function segmentData(data, W, H, thr) {
    // --- color de fondo: mediana de una franja en el borde de la imagen
    const bw = Math.max(4, Math.round(Math.min(W, H) * 0.03));
    const rs = [], gs = [], bs = [];
    const push = (x, y) => {
      const i = (y * W + x) * 4;
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    };
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < bw; x++) { push(x, y); push(W - 1 - x, y); }
    }
    for (let x = 0; x < W; x += 3) {
      for (let y = 0; y < bw; y++) { push(x, y); push(x, H - 1 - y); }
    }
    const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    const bgR = med(rs), bgG = med(gs), bgB = med(bs);

    // --- distancia de color al fondo
    let d = new Float32Array(W * H);
    for (let i = 0, p = 0; i < d.length; i++, p += 4) {
      const dr = data[p] - bgR, dg = data[p + 1] - bgG, db = data[p + 2] - bgB;
      d[i] = Math.sqrt(dr * dr + dg * dg + db * db);
    }
    d = boxBlur(d, W, H, 1);

    // --- máscara binaria
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < mask.length; i++) mask[i] = d[i] > thr ? 1 : 0;

    // --- componente conexa más grande (4-vecindad, sin recursión)
    const label = new Int32Array(W * H);
    const stack = new Int32Array(W * H);
    let best = 0, bestSize = 0, cur = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || label[i]) continue;
      cur++;
      let sp = 0, size = 0;
      stack[sp++] = i; label[i] = cur;
      while (sp) {
        const p = stack[--sp];
        size++;
        const x = p % W, y = (p / W) | 0;
        let q;
        if (x > 0)     { q = p - 1; if (mask[q] && !label[q]) { label[q] = cur; stack[sp++] = q; } }
        if (x < W - 1) { q = p + 1; if (mask[q] && !label[q]) { label[q] = cur; stack[sp++] = q; } }
        if (y > 0)     { q = p - W; if (mask[q] && !label[q]) { label[q] = cur; stack[sp++] = q; } }
        if (y < H - 1) { q = p + W; if (mask[q] && !label[q]) { label[q] = cur; stack[sp++] = q; } }
      }
      if (size > bestSize) { bestSize = size; best = cur; }
    }
    if (!best || bestSize < W * H * 0.005) return null;

    // --- borde izquierdo/derecho por fila (rellena huecos: etiquetas, vidrio)
    const left = new Int16Array(H).fill(-1);
    const right = new Int16Array(H).fill(-1);
    let top = -1, bottom = -1;
    for (let y = 0; y < H; y++) {
      let l = -1, r = -1;
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (label[row + x] === best) { if (l < 0) l = x; r = x; }
      }
      if (l >= 0) {
        left[y] = l; right[y] = r;
        if (top < 0) top = y;
        bottom = y;
      }
    }
    return { left, right, top, bottom, W, H, bg: [bgR, bgG, bgB] };
  }

  /* ================= 2. PERFIL r(z) Y MODELO DE VOLUMEN ================= */

  // Toma N nodos equiespaciados en altura. z=0 es la base, z=H la tapa.
  function buildProfile(seg, realH, N) {
    N = N || 41; // 40 subintervalos
    const hpx = seg.bottom - seg.top + 1;
    const scale = realH / Math.max(1, hpx - 1);     // cm por píxel
    const z = [], r = [];
    const win = 2;                                   // promedio de ±2 filas
    for (let i = 0; i < N; i++) {
      const zi = (i * realH) / (N - 1);
      const yc = Math.round(seg.bottom - zi / scale);
      let s = 0, c = 0;
      for (let dy = -win; dy <= win; dy++) {
        const y = yc + dy;
        if (y < seg.top || y > seg.bottom) continue;
        s += seg.right[y] - seg.left[y] + 1;
        c++;
      }
      const wpx = c ? s / c : 0;
      z.push(zi);
      r.push(Math.max((wpx / 2) * scale, 0.01));
    }
    return { z, r, H: realH, scale, N, hpx };
  }

  // r(z) lineal por tramos. V(h) se integra exacto en cada tramo
  // (Simpson es exacto para r² cuando r es lineal).
  function makeModel(prof) {
    const { z, r, N, H } = prof;
    const dz = z[1] - z[0];
    const cum = [0];
    for (let k = 0; k < N - 1; k++) {
      const rm = (r[k] + r[k + 1]) / 2;
      cum.push(cum[k] + (Math.PI * dz / 6) * (r[k] * r[k] + 4 * rm * rm + r[k + 1] * r[k + 1]));
    }
    const clamp = (h) => Math.min(Math.max(h, 0), H);
    const idx = (h) => Math.min(N - 2, Math.floor(h / dz));
    const rAt = (h) => {
      h = clamp(h);
      const k = idx(h);
      return r[k] + ((r[k + 1] - r[k]) * (h - z[k])) / dz;
    };
    const V = (h) => {
      h = clamp(h);
      const k = idx(h);
      const t = h - z[k];
      const s = (r[k + 1] - r[k]) / dz;
      return cum[k] + Math.PI * (r[k] * r[k] * t + r[k] * s * t * t + (s * s * t * t * t) / 3);
    };
    return { V, rAt, total: cum[N - 1], cum, dz };
  }

  /* ================= 3. LOS 5 MÉTODOS NUMÉRICOS ================= */
  // Todos devuelven { root, iters:[{i,x,fx,err}], ok, note }

  const TOL = 1e-6;     // tolerancia en h (cm)
  const FTOL = 1e-6;    // tolerancia en f (mL)
  const MAXIT = 1000;

  function biseccion(f, a, b) {
    const iters = [];
    let fa = f(a), c = a;
    for (let i = 1; i <= MAXIT; i++) {
      c = (a + b) / 2;
      const fc = f(c);
      const err = (b - a) / 2;
      iters.push({ i, x: c, fx: fc, err });
      if (Math.abs(fc) < FTOL || err < TOL) return { root: c, iters, ok: true };
      if (fa * fc < 0) { b = c; } else { a = c; fa = fc; }
    }
    return { root: c, iters, ok: false, note: 'Máx. iteraciones' };
  }

  function falsaPosicion(f, a, b) {
    const iters = [];
    let fa = f(a), fb = f(b), c = a, prev = NaN;
    for (let i = 1; i <= MAXIT; i++) {
      if (fb === fa) return { root: c, iters, ok: false, note: 'f(a) = f(b): sin cambio de signo' };
      c = b - (fb * (b - a)) / (fb - fa);
      const fc = f(c);
      const err = Number.isNaN(prev) ? NaN : Math.abs(c - prev);
      iters.push({ i, x: c, fx: fc, err });
      if (Math.abs(fc) < FTOL || (!Number.isNaN(err) && err < TOL)) return { root: c, iters, ok: true };
      if (fa * fc < 0) { b = c; fb = fc; } else { a = c; fa = fc; }
      prev = c;
    }
    return { root: c, iters, ok: false, note: 'Máx. iteraciones' };
  }

  function newtonRaphson(f, df, x0, lo, hi) {
    const iters = [];
    let x = x0;
    for (let i = 1; i <= MAXIT; i++) {
      const d = df(x);
      if (Math.abs(d) < 1e-12) return { root: x, iters, ok: false, note: "f'(x) ≈ 0" };
      let xn = x - f(x) / d;
      xn = Math.min(Math.max(xn, lo), hi);          // mantener x dentro de la botella
      const fx = f(xn), err = Math.abs(xn - x);
      iters.push({ i, x: xn, fx, err });
      x = xn;
      if (err < TOL || Math.abs(fx) < FTOL) return { root: x, iters, ok: true };
    }
    return { root: x, iters, ok: false, note: 'Máx. iteraciones' };
  }

  function secante(f, x0, x1, lo, hi) {
    const iters = [];
    let f0 = f(x0), f1 = f(x1);
    for (let i = 1; i <= MAXIT; i++) {
      if (Math.abs(f1 - f0) < 1e-14) return { root: x1, iters, ok: false, note: 'f(x₁) − f(x₀) ≈ 0' };
      let x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
      x2 = Math.min(Math.max(x2, lo), hi);
      const f2 = f(x2), err = Math.abs(x2 - x1);
      iters.push({ i, x: x2, fx: f2, err });
      x0 = x1; f0 = f1; x1 = x2; f1 = f2;
      if (err < TOL || Math.abs(f2) < FTOL) return { root: x1, iters, ok: true };
    }
    return { root: x1, iters, ok: false, note: 'Máx. iteraciones' };
  }

  // g(x) = x − f(x)/M  con  M = π·r_max².
  // g'(x) = 1 − π r(x)²/M ∈ [0,1)  ->  |g'| < 1: converge (monótono).
  function puntoFijo(f, g, x0) {
    const iters = [];
    let x = x0;
    for (let i = 1; i <= MAXIT; i++) {
      const xn = g(x);
      const err = Math.abs(xn - x);
      iters.push({ i, x: xn, fx: f(xn), err });
      x = xn;
      if (err < TOL) return { root: x, iters, ok: true };
    }
    return { root: x, iters, ok: false, note: 'Máx. iteraciones' };
  }

  function resolverTodos(model, prof, Vt) {
    const H = prof.H;
    const f = (h) => model.V(h) - Vt;
    const df = (h) => Math.PI * model.rAt(h) * model.rAt(h);
    const rmax = Math.max.apply(null, prof.r);
    const M = Math.PI * rmax * rmax;
    const g = (h) => Math.min(Math.max(h - f(h) / M, 0), H);
    return [
      { name: 'Bisección',       color: '#e53935', formula: '[a,b] = [0, H];  c = (a+b)/2',                       ...biseccion(f, 0, H) },
      { name: 'Falsa posición',  color: '#8e24aa', formula: 'c = b − f(b)(b−a)/(f(b)−f(a))',                     ...falsaPosicion(f, 0, H) },
      { name: 'Newton-Raphson',  color: '#fb8c00', formula: "xₙ₊₁ = xₙ − f(xₙ)/f'(xₙ),  f'(h) = π·r(h)²",        ...newtonRaphson(f, df, H / 2, 0, H) },
      { name: 'Secante',         color: '#43a047', formula: 'xₙ₊₁ = xₙ − f(xₙ)(xₙ−xₙ₋₁)/(f(xₙ)−f(xₙ₋₁))',        ...secante(f, 0.2 * H, 0.8 * H, 0, H) },
      { name: 'Punto fijo',      color: '#1e88e5', formula: 'g(x) = x − f(x)/M,  M = π·r²máx = ' + M.toFixed(3), ...puntoFijo(f, g, H / 2) }
    ];
  }

  const API = { segmentData, buildProfile, makeModel, biseccion, falsaPosicion, newtonRaphson, secante, puntoFijo, resolverTodos };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  /* ================= 4. INTERFAZ ================= */
  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', function () {
    const $ = (id) => document.getElementById(id);
    const video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d');
    const plotCanvas = $('plotCanvas');
    const btnStart = $('btnStartCamera'), btnCapture = $('btnCapture');
    const btnReset = $('btnReset'), btnCalc = $('btnCalculate');
    const fileInput = $('fileInput'), sens = $('sensitivity'), sensVal = $('sensVal');
    const statusEl = $('status');

    const MAXSIDE = 800;      // lado máximo de trabajo (px)
    let stream = null, photo = null, seg = null, result = null;

    const setStatus = (t) => { statusEl.textContent = t; };

    /* ---------- cámara ---------- */
    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('La cámara en vivo necesita HTTPS. Usa "Subir / tomar foto".');
        fileInput.click();
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false
        });
        video.srcObject = stream;
        video.style.display = 'block';
        video.style.width = '100%';
        canvas.style.display = 'none';
        await video.play();
        btnCapture.disabled = false;
        setStatus('Encuadra la botella completa, de lado y sobre un fondo liso. Luego toca "Capturar Foto".');
      } catch (e) {
        setStatus('No se pudo abrir la cámara (' + e.name + '). Usa "Subir / tomar foto".');
        fileInput.click();
      }
    }

    function stopCamera() {
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      video.style.display = 'none';
      btnCapture.disabled = true;
    }

    function capture() {
      if (!video.videoWidth) return;
      loadSource(video, video.videoWidth, video.videoHeight);
      stopCamera();
    }

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        stopCamera();
        loadSource(img, img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
      fileInput.value = '';
    });

    function loadSource(src, w, h) {
      const s = Math.min(1, MAXSIDE / Math.max(w, h));
      photo = document.createElement('canvas');
      photo.width = Math.round(w * s);
      photo.height = Math.round(h * s);
      photo.getContext('2d').drawImage(src, 0, 0, photo.width, photo.height);
      canvas.width = photo.width;
      canvas.height = photo.height;
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      $('resultsCard').style.display = 'none';
      result = null;
      runSegmentation();
    }

    /* ---------- segmentación ---------- */
    function runSegmentation() {
      if (!photo) return;
      const data = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height).data;
      seg = segmentData(data, photo.width, photo.height, +sens.value);
      result = null;
      if (!seg) {
        drawBase();
        btnCalc.disabled = true;
        setStatus('No se detectó la botella. Baja la sensibilidad o usa un fondo liso y con contraste.');
        return;
      }
      drawOverlay();
      btnCalc.disabled = false;
      setStatus('Silueta detectada (verde). Si sobra o falta algo, ajusta la sensibilidad. Luego toca "Calcular Volumen".');
    }

    sens.addEventListener('input', () => { sensVal.textContent = sens.value; });
    sens.addEventListener('change', runSegmentation);

    /* ---------- dibujo sobre la foto ---------- */
    function drawBase() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (photo) ctx.drawImage(photo, 0, 0);
    }

    function label(text, x, y, size) {
      ctx.font = 'bold ' + size + 'px sans-serif';
      ctx.lineWidth = Math.max(3, size / 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x, y);
    }

    function drawOverlay() {
      drawBase();
      if (!seg) return;
      const { left, right, top, bottom } = seg;
      const lw = Math.max(2, canvas.width / 300);
      const fs = Math.max(12, canvas.width / 30);

      // líquido (debajo del nivel h)
      if (result && result.hFinal !== null) {
        const yF = Math.round(bottom - result.hFinal / result.prof.scale);
        ctx.fillStyle = 'rgba(33,150,243,0.38)';
        for (let y = Math.max(top, yF); y <= bottom; y++) {
          if (left[y] >= 0) ctx.fillRect(left[y], y, right[y] - left[y] + 1, 1);
        }
      }

      // silueta
      ctx.strokeStyle = '#00e676';
      ctx.lineWidth = lw;
      [left, right].forEach((edge) => {
        ctx.beginPath();
        let first = true;
        for (let y = top; y <= bottom; y++) {
          if (edge[y] < 0) continue;
          if (first) { ctx.moveTo(edge[y] + (edge === right ? 1 : 0), y); first = false; }
          else ctx.lineTo(edge[y] + (edge === right ? 1 : 0), y);
        }
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(left[top], top); ctx.lineTo(right[top] + 1, top);
      ctx.moveTo(left[bottom], bottom); ctx.lineTo(right[bottom] + 1, bottom);
      ctx.stroke();

      if (!result) return;
      const { prof } = result;

      // eje central
      let cx = 0, n = 0;
      for (let y = top; y <= bottom; y++) if (left[y] >= 0) { cx += (left[y] + right[y]) / 2; n++; }
      cx /= n;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bottom); ctx.stroke();
      ctx.setLineDash([]);

      // discos (z_i, r_i): cada nodo es un radio medido
      ctx.strokeStyle = 'rgba(255,193,7,0.95)';
      ctx.fillStyle = '#ffc107';
      ctx.lineWidth = Math.max(1, lw / 2);
      for (let i = 0; i < prof.N; i++) {
        const y = bottom - prof.z[i] / prof.scale;
        const half = prof.r[i] / prof.scale;
        ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx - half, y, lw * 1.3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + half, y, lw * 1.3, 0, 7); ctx.fill();
      }

      // nivel de líquido hallado
      if (result.hFinal !== null) {
        const yF = bottom - result.hFinal / prof.scale;
        ctx.strokeStyle = '#ff1744';
        ctx.lineWidth = lw;
        ctx.setLineDash([12, 8]);
        ctx.beginPath(); ctx.moveTo(0, yF); ctx.lineTo(canvas.width, yF); ctx.stroke();
        ctx.setLineDash([]);
        label('h = ' + result.hFinal.toFixed(2) + ' cm  →  ' + result.Vt.toFixed(0) + ' mL', 8, Math.max(fs + 2, yF - 8), fs);
      }
      label('V total ≈ ' + result.model.total.toFixed(1) + ' mL', 8, canvas.height - 10, fs);
    }

    /* ---------- gráfica V(h) con las raíces ---------- */
    function drawPlot(res) {
      const g = plotCanvas.getContext('2d');
      const W = (plotCanvas.width = 640), H = (plotCanvas.height = 320);
      const padL = 58, padR = 16, padT = 16, padB = 42;
      const { prof, model, Vt, methods } = res;
      const px = (h) => padL + (h / prof.H) * (W - padL - padR);
      const py = (v) => H - padB - (v / model.total) * (H - padT - padB);

      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#ddd'; g.fillStyle = '#333'; g.lineWidth = 1; g.font = '12px sans-serif';
      for (let i = 0; i <= 5; i++) {
        const v = (model.total * i) / 5, h = (prof.H * i) / 5;
        g.beginPath(); g.moveTo(padL, py(v)); g.lineTo(W - padR, py(v)); g.stroke();
        g.textAlign = 'right'; g.fillText(v.toFixed(0), padL - 6, py(v) + 4);
        g.textAlign = 'center'; g.fillText(h.toFixed(1), px(h), H - padB + 16);
      }
      g.textAlign = 'center';
      g.fillText('h: altura del líquido (cm)', (W + padL) / 2, H - 6);
      g.save(); g.translate(14, H / 2); g.rotate(-Math.PI / 2); g.fillText('V(h) (mL)', 0, 0); g.restore();

      g.strokeStyle = '#1565c0'; g.lineWidth = 2.5; g.beginPath();
      for (let i = 0; i <= 200; i++) {
        const h = (prof.H * i) / 200;
        if (i === 0) g.moveTo(px(h), py(model.V(h))); else g.lineTo(px(h), py(model.V(h)));
      }
      g.stroke();

      if (Vt > 0 && Vt < model.total) {
        g.strokeStyle = '#d32f2f'; g.lineWidth = 1.5; g.setLineDash([6, 5]);
        g.beginPath(); g.moveTo(padL, py(Vt)); g.lineTo(W - padR, py(Vt)); g.stroke();
        g.setLineDash([]);
        g.fillStyle = '#d32f2f'; g.textAlign = 'left';
        g.fillText('V objetivo = ' + Vt + ' mL', padL + 6, py(Vt) - 6);
        methods.forEach((m, k) => {
          g.fillStyle = m.color;
          g.beginPath(); g.arc(px(m.root), py(model.V(m.root)), 7 - k, 0, 7); g.fill();
        });
      }
    }

    /* ---------- tablas de resultados ---------- */
    const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '—');

    function iterTable(m) {
      const MAXROWS = 60;
      const rows = m.iters.slice(0, MAXROWS).map((it) =>
        '<tr><td>' + it.i + '</td><td>' + fmt(it.x, 6) + '</td><td>' + fmt(it.fx, 6) + '</td><td>' + fmt(it.err, 8) + '</td></tr>'
      ).join('');
      const more = m.iters.length > MAXROWS ? '<p class="hint">Se muestran las primeras ' + MAXROWS + ' de ' + m.iters.length + ' iteraciones.</p>' : '';
      return '<details><summary><span class="chip" style="background:' + m.color + '"></span>' + m.name +
        ' — tabla de iteraciones</summary><p class="hint">' + m.formula + '</p>' +
        '<div class="tbl-scroll"><table><thead><tr><th>i</th><th>h (cm)</th><th>f(h) (mL)</th><th>|Δh|</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>' + more + '</details>';
    }

    function renderMethods(res) {
      const out = $('methodsOut');
      if (!res.methods) { out.innerHTML = ''; return; }
      const head = '<h3>Nivel de líquido para ' + res.Vt + ' mL</h3>' +
        '<div class="tbl-scroll"><table class="method-table"><thead><tr><th>Método</th><th>h (cm)</th><th>Iter.</th><th>|f(h)| (mL)</th><th>Estado</th></tr></thead><tbody>';
      const body = res.methods.map((m) =>
        '<tr><td><span class="chip" style="background:' + m.color + '"></span>' + m.name + '</td><td>' + fmt(m.root, 5) +
        '</td><td>' + m.iters.length + '</td><td>' + fmt(Math.abs(res.model.V(m.root) - res.Vt), 8) +
        '</td><td>' + (m.ok ? 'Convergió' : 'Falló: ' + m.note) + '</td></tr>'
      ).join('');
      out.innerHTML = head + body + '</tbody></table></div>' + res.methods.map(iterTable).join('');
    }

    /* ---------- calcular ---------- */
    function calculate() {
      if (!seg) return;
      const realH = parseFloat($('realHeight').value);
      const Vt = parseFloat($('targetVolume').value);
      if (!(realH > 0)) { setStatus('Escribe una altura real válida en cm.'); return; }

      const prof = buildProfile(seg, realH, 41);
      const model = makeModel(prof);
      result = { prof, model, Vt, methods: null, hFinal: null };

      const summary = $('secanteResult');
      if (Vt > 0 && Vt < model.total) {
        result.methods = resolverTodos(model, prof, Vt);
        const good = result.methods.filter((m) => m.ok);
        if (good.length) {
          result.hFinal = good.reduce((s, m) => s + m.root, 0) / good.length;
          summary.textContent = 'Para ' + Vt + ' mL el líquido llega a h ≈ ' + result.hFinal.toFixed(3) +
            ' cm (' + good.length + ' de 5 métodos convergieron).';
        } else {
          summary.textContent = 'Ningún método convergió. Revisa la silueta.';
        }
      } else if (Vt >= model.total) {
        summary.textContent = 'El volumen objetivo (' + Vt + ' mL) es mayor o igual al volumen total de la botella (' + model.total.toFixed(1) + ' mL).';
      } else {
        summary.textContent = 'Escribe un volumen objetivo mayor que 0 para buscar el nivel de líquido.';
      }

      $('volResult').textContent = model.total.toFixed(2);
      $('pointsCount').textContent = prof.N;
      $('datasetTable').querySelector('tbody').innerHTML = prof.z.map((zi, i) =>
        '<tr><td>' + (i + 1) + '</td><td>' + zi.toFixed(3) + '</td><td>' + prof.r[i].toFixed(3) + '</td></tr>'
      ).join('');

      renderMethods(result);
      drawPlot(result);
      $('resultsCard').style.display = 'block';
      drawOverlay();
      $('resultsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setStatus('Listo. La silueta, los discos y el nivel de líquido están dibujados sobre la foto.');
    }

    /* ---------- reiniciar ---------- */
    function reset() {
      stopCamera();
      photo = null; seg = null; result = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
      $('resultsCard').style.display = 'none';
      btnCalc.disabled = true;
      setStatus('Toca "Iniciar Cámara" o "Subir / tomar foto".');
    }

    btnStart.addEventListener('click', startCamera);
    btnCapture.addEventListener('click', capture);
    btnCalc.addEventListener('click', calculate);
    btnReset.addEventListener('click', reset);
    setStatus('Toca "Iniciar Cámara" o "Subir / tomar foto".');
  });
})();