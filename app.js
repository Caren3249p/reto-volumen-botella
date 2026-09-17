// Referencias al DOM
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const btnStartCamera = document.getElementById('btnStartCamera');
const btnCapture = document.getElementById('btnCapture');
const btnReset = document.getElementById('btnReset');
const btnCalculate = document.getElementById('btnCalculate');

// Inputs Dinámicos de Calibración
const realHeightInput = document.getElementById('realHeight');
const targetVolumeInput = document.getElementById('targetVolume'); // Debe existir en el HTML

let stream = null;
let calibrationPoints = [];
let imageCaptured = false;
let capturedImageObj = null;

const PI = Math.PI;

// -------------------------------------------------------------
// 1. VISIÓN ARTIFICIAL: Detección Adaptativa según el Envase
// -------------------------------------------------------------

function extraerPerfilRealDeImagen(topPt, bottomPt, realHeightCm, maxRadiusPt) {
    const n = 30; // 30 nodos para adaptarse a cualquier curvatura
    const dyPixel = (bottomPt.y - topPt.y) / n;
    const cmPerPixel = realHeightCm / Math.abs(bottomPt.y - topPt.y);
    const centerXPixel = (topPt.x + bottomPt.x) / 2;
    const maxRadiusCm = Math.abs(maxRadiusPt.x - centerXPixel) * cmPerPixel;

    let rawNodes = [];

    for (let i = 0; i <= n; i++) {
        let currentY = bottomPt.y - (i * dyPixel);
        let z_i = i * (realHeightCm / n);
        
        let searchWidth = Math.floor(Math.abs(maxRadiusPt.x - centerXPixel) * 1.3);
        let detectedRadiusPx = Math.abs(maxRadiusPt.x - centerXPixel);

        try {
            let imgDataRight = ctx.getImageData(Math.floor(centerXPixel), Math.floor(currentY), searchWidth, 1).data;
            let maxGrad = 0;
            let bestOffset = detectedRadiusPx;

            for (let px = 4; px < imgDataRight.length - 8; px += 4) {
                let b1 = (imgDataRight[px] + imgDataRight[px+1] + imgDataRight[px+2]) / 3;
                let b2 = (imgDataRight[px+4] + imgDataRight[px+5] + imgDataRight[px+6]) / 3;
                let grad = Math.abs(b2 - b1);

                if (grad > maxGrad) {
                    maxGrad = grad;
                    bestOffset = px / 4;
                }
            }

            if (maxGrad > 10) detectedRadiusPx = bestOffset;
        } catch (e) {}

        let r_i = detectedRadiusPx * cmPerPixel;
        if (r_i > maxRadiusCm * 1.08) r_i = maxRadiusCm;
        if (r_i < maxRadiusCm * 0.15) r_i = maxRadiusCm * 0.15;

        rawNodes.push({ z: z_i, r: r_i });
    }

    return { rawNodes };
}

// -------------------------------------------------------------
// 2. INTERPOLACIÓN: Spline Cúbico Adaptativo
// -------------------------------------------------------------

function calcularSplineCubico(nodes) {
    const n = nodes.length - 1;
    let a = nodes.map(p => p.r);
    let h = [];
    for (let i = 0; i < n; i++) h[i] = nodes[i + 1].z - nodes[i].z;

    let alpha = [0];
    for (let i = 1; i < n; i++) {
        alpha[i] = (3 / h[i]) * (a[i + 1] - a[i]) - (3 / h[i - 1]) * (a[i] - a[i - 1]);
    }

    let l = [1], mu = [0], z = [0];
    for (let i = 1; i < n; i++) {
        l[i] = 2 * (nodes[i + 1].z - nodes[i - 1].z) - h[i - 1] * mu[i - 1];
        mu[i] = h[i] / l[i];
        z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
    }

    l[n] = 1; z[n] = 0;
    let c = new Array(n + 1).fill(0);
    let b = new Array(n).fill(0);
    let d = new Array(n).fill(0);

    for (let j = n - 1; j >= 0; j--) {
        c[j] = z[j] - mu[j] * c[j + 1];
        b[j] = (a[j + 1] - a[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
        d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
    }

    return function(zEval) {
        if (zEval <= nodes[0].z) return nodes[0].r;
        if (zEval >= nodes[n].z) return nodes[n].r;
        let i = nodes.findIndex((pt, idx) => idx < n && zEval >= pt.z && zEval <= nodes[idx + 1].z);
        if (i === -1) i = n - 1;
        let dx = zEval - nodes[i].z;
        return a[i] + b[i] * dx + c[i] * dx * dx + d[i] * dx * dx * dx;
    };
}

// -------------------------------------------------------------
// 3. INTEGRACIÓN NUMÉRICA: Simpson 1/3
// -------------------------------------------------------------

function integrarSimpson(rFunc, zMin, zMax, numIntervalos = 80) {
    if (zMin >= zMax) return 0;
    if (numIntervalos % 2 !== 0) numIntervalos++;
    const h = (zMax - zMin) / numIntervalos;
    let suma = Math.pow(rFunc(zMin), 2) + Math.pow(rFunc(zMax), 2);

    for (let i = 1; i < numIntervalos; i++) {
        let z = zMin + i * h;
        let r = rFunc(z);
        let factor = (i % 2 === 0) ? 2 : 4;
        suma += factor * Math.pow(r, 2);
    }

    return (PI * h / 3) * suma;
}

function fObjetivo(h, vObjetivo, rFunc) {
    return integrarSimpson(rFunc, 0, h) - vObjetivo;
}

// -------------------------------------------------------------
// 4. LOS 5 MÉTODOS NUMÉRICOS DE BÚSQUEDA DE RAÍCES
// -------------------------------------------------------------

function metodoBiseccion(vObjetivo, rFunc, maxH, tol = 1e-4, maxIter = 50) {
    let a = 0, b = maxH, c = a, iter = 0;
    while ((b - a) / 2 > tol && iter < maxIter) {
        c = (a + b) / 2;
        let fc = fObjetivo(c, vObjetivo, rFunc);
        if (Math.abs(fc) < tol) break;
        if (fObjetivo(a, vObjetivo, rFunc) * fc < 0) b = c; else a = c;
        iter++;
    }
    return { altura: c, iter };
}

function metodoFalsaPosicion(vObjetivo, rFunc, maxH, tol = 1e-4, maxIter = 50) {
    let a = 0, b = maxH, c = a, iter = 0;
    for (iter = 0; iter < maxIter; iter++) {
        let fa = fObjetivo(a, vObjetivo, rFunc);
        let fb = fObjetivo(b, vObjetivo, rFunc);
        if (Math.abs(fb - fa) < 1e-6) break;
        c = b - (fb * (b - a)) / (fb - fa);
        let fc = fObjetivo(c, vObjetivo, rFunc);
        if (Math.abs(fc) < tol) break;
        if (fa * fc < 0) b = c; else a = c;
    }
    return { altura: c, iter };
}

function metodoPuntoFijo(vObjetivo, rFunc, maxH, tol = 1e-4, maxIter = 50) {
    let h = maxH * 0.5, iter = 0;
    let rProm = rFunc(maxH * 0.5);
    let K = PI * rProm * rProm;
    if (K === 0) K = 1;

    while (iter < maxIter) {
        let fh = fObjetivo(h, vObjetivo, rFunc);
        if (Math.abs(fh) < tol) break;
        let hNext = h - fh / K;
        if (Math.abs(hNext - h) < tol) break;
        h = hNext;
        iter++;
    }
    return { altura: Math.min(Math.max(h, 0), maxH), iter };
}

function metodoNewtonRaphson(vObjetivo, rFunc, maxH, tol = 1e-4, maxIter = 50) {
    let h = maxH * 0.5, iter = 0;
    while (iter < maxIter) {
        let fh = fObjetivo(h, vObjetivo, rFunc);
        if (Math.abs(fh) < tol) break;
        let r_h = rFunc(h);
        let dfh = PI * r_h * r_h; // Derivada dV/dh = A(h)
        if (Math.abs(dfh) < 1e-6) break;
        let hNext = h - fh / dfh;
        if (Math.abs(hNext - h) < tol) break;
        h = hNext;
        iter++;
    }
    return { altura: Math.min(Math.max(h, 0), maxH), iter };
}

function metodoSecante(vObjetivo, rFunc, maxH, tol = 1e-4, maxIter = 50) {
    let h0 = maxH * 0.3, h1 = maxH * 0.8, iter = 0, hNext = h1;
    while (iter < maxIter) {
        let f_h0 = fObjetivo(h0, vObjetivo, rFunc);
        let f_h1 = fObjetivo(h1, vObjetivo, rFunc);
        if (Math.abs(f_h1 - f_h0) < 1e-6) break;
        hNext = h1 - (f_h1 * (h1 - h0)) / (f_h1 - f_h0);
        if (Math.abs(f_h1) < tol) break;
        h0 = h1; h1 = hNext; iter++;
    }
    return { altura: Math.min(Math.max(hNext, 0), maxH), iter };
}

// -------------------------------------------------------------
// 5. CONTROL DE CÁMARA Y EVENTOS
// -------------------------------------------------------------

btnStartCamera.addEventListener('click', async () => {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        video.style.display = 'block';
        canvas.style.display = 'none';
        btnCapture.disabled = false;
    } catch (err) {
        alert('Error al acceder a la cámara.');
    }
});

btnCapture.addEventListener('click', () => {
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (stream) stream.getTracks().forEach(track => track.stop());
    video.style.display = 'none';
    canvas.style.display = 'block';
    btnCapture.disabled = true;
    imageCaptured = true;
    capturedImageObj = new Image();
    capturedImageObj.src = canvas.toDataURL('image/png');
});

canvas.addEventListener('click', (e) => {
    if (!imageCaptured) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let x = (e.clientX - rect.left) * scaleX;
    let y = (e.clientY - rect.top) * scaleY;

    if (calibrationPoints.length < 3) {
        calibrationPoints.push({ x, y });
        redrawCanvas();
        if (calibrationPoints.length === 3) btnCalculate.disabled = false;
    }
});

function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (capturedImageObj) ctx.drawImage(capturedImageObj, 0, 0);

    const labels = ["Tapa", "Base", "Borde Max"];
    const colors = ["#007bff", "#007bff", "#ff1744"];

    calibrationPoints.forEach((pt, i) => {
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 7, 0, 2 * PI);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(labels[i], pt.x + 10, pt.y + 4);
    });

    if (calibrationPoints.length >= 2) {
        ctx.strokeStyle = 'rgba(0, 123, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(calibrationPoints[0].x, calibrationPoints[0].y);
        ctx.lineTo(calibrationPoints[1].x, calibrationPoints[1].y);
        ctx.stroke();
    }
}

// -------------------------------------------------------------
// EXECUCIÓN DINÁMICA DE RESULTADOS
// -------------------------------------------------------------

btnCalculate.addEventListener('click', () => {
    if (calibrationPoints.length < 3) return;

    // Lectura de los valores reales ingresados
    const realHeightCm = parseFloat(realHeightInput.value) || 15.0;
    const vObjetivo = (targetVolumeInput && targetVolumeInput.value) ? parseFloat(targetVolumeInput.value) : 250.0;

    const topPt = calibrationPoints[0];
    const bottomPt = calibrationPoints[1];
    const maxRadiusPt = calibrationPoints[2];

    // 1. Detección visual adaptativa
    const { rawNodes } = extraerPerfilRealDeImagen(topPt, bottomPt, realHeightCm, maxRadiusPt);

    // 2. Interpolación Spline
    const rSpline = calcularSplineCubico(rawNodes);

    const totalPuntos = 60;
    let dataset = [];
    for (let i = 0; i <= totalPuntos; i++) {
        let z = i * (realHeightCm / totalPuntos);
        let r = rSpline(z);
        dataset.push({ z, r });
    }

    // 3. Volumen total por Simpson
    const volumeCm3 = integrarSimpson(rSpline, 0, realHeightCm, 80);

    // Validación de seguridad si el objetivo supera la capacidad
    let vObjReal = vObjetivo;
    if (vObjetivo > volumeCm3) {
        vObjReal = volumeCm3 * 0.8; // Ajustar automáticamente si se pasa de la capacidad total
    }

    // 4. Ejecución de Métodos de Raíces
    const resBiseccion = metodoBiseccion(vObjReal, rSpline, realHeightCm);
    const resFalsaPos = metodoFalsaPosicion(vObjReal, rSpline, realHeightCm);
    const resPuntoFijo = metodoPuntoFijo(vObjReal, rSpline, realHeightCm);
    const resNewton = metodoNewtonRaphson(vObjReal, rSpline, realHeightCm);
    const resSecante = metodoSecante(vObjReal, rSpline, realHeightCm);

    // Renderizar en UI
    document.getElementById('volResult').textContent = volumeCm3.toFixed(2);
    document.getElementById('pointsCount').textContent = dataset.length;

    const secanteEl = document.getElementById('secanteResult');
    if (secanteEl) {
        secanteEl.innerHTML = `
            <b>Resultados para Volumen Objetivo = ${vObjReal.toFixed(1)} mL:</b><br>
            • Bisección: ${resBiseccion.altura.toFixed(2)} cm (${resBiseccion.iter} iter)<br>
            • Falsa Posición: ${resFalsaPos.altura.toFixed(2)} cm (${resFalsaPos.iter} iter)<br>
            • Punto Fijo: ${resPuntoFijo.altura.toFixed(2)} cm (${resPuntoFijo.iter} iter)<br>
            • Newton-Raphson: ${resNewton.altura.toFixed(2)} cm (${resNewton.iter} iter)<br>
            • Secante: ${resSecante.altura.toFixed(2)} cm (${resSecante.iter} iter)
        `;
    }

    const tbody = document.querySelector('#datasetTable tbody');
    tbody.innerHTML = '';
    dataset.forEach((data, i) => {
        tbody.innerHTML += `<tr><td>${i + 1}</td><td>${data.z.toFixed(2)}</td><td>${data.r.toFixed(2)}</td></tr>`;
    });

    document.getElementById('resultsCard').style.display = 'block';

    graficarSiluetaDesdeTabla(dataset, realHeightCm);
});

function graficarSiluetaDesdeTabla(dataset, realHeightCm) {
    let graphCanvas = document.getElementById('siluetaCanvas');
    const datasetTable = document.getElementById('datasetTable');
    
    if (!graphCanvas) {
        graphCanvas = document.createElement('canvas');
        graphCanvas.id = 'siluetaCanvas';
        graphCanvas.width = 300;
        graphCanvas.height = 350;
        graphCanvas.style.display = 'block';
        graphCanvas.style.margin = '20px auto';
        graphCanvas.style.background = '#121212';
        graphCanvas.style.borderRadius = '8px';
        graphCanvas.style.border = '1px solid #333';
        datasetTable.parentNode.insertBefore(graphCanvas, datasetTable.nextSibling);
    }

    const gCtx = graphCanvas.getContext('2d');
    gCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);

    const padding = 30;
    const drawWidth = graphCanvas.width - (padding * 2);
    const drawHeight = graphCanvas.height - (padding * 2);
    const centerX = graphCanvas.width / 2;

    let maxR = Math.max(...dataset.map(d => d.r));
    const scaleX = (drawWidth / 2) / (maxR * 1.15);
    const scaleY = drawHeight / realHeightCm;

    gCtx.strokeStyle = '#555';
    gCtx.setLineDash([4, 4]);
    gCtx.beginPath();
    gCtx.moveTo(centerX, 10);
    gCtx.lineTo(centerX, graphCanvas.height - 10);
    gCtx.stroke();
    gCtx.setLineDash([]);

    gCtx.beginPath();
    dataset.forEach((pt, i) => {
        let x = centerX + (pt.r * scaleX);
        let y = (graphCanvas.height - padding) - (pt.z * scaleY);
        if (i === 0) gCtx.moveTo(x, y); else gCtx.lineTo(x, y);
    });
    for (let i = dataset.length - 1; i >= 0; i--) {
        let x = centerX - (dataset[i].r * scaleX);
        let y = (graphCanvas.height - padding) - (dataset[i].z * scaleY);
        gCtx.lineTo(x, y);
    }
    gCtx.closePath();

    gCtx.fillStyle = 'rgba(0, 230, 118, 0.2)';
    gCtx.fill();
    gCtx.strokeStyle = '#00e676';
    gCtx.lineWidth = 2;
    gCtx.stroke();
}

btnReset.addEventListener('click', () => {
    calibrationPoints = [];
    btnCalculate.disabled = true;
    document.getElementById('resultsCard').style.display = 'none';
    const siluetaCanvas = document.getElementById('siluetaCanvas');
    if (siluetaCanvas) siluetaCanvas.remove();
    redrawCanvas();
});