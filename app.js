// Referencias al DOM
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const btnStartCamera = document.getElementById('btnStartCamera');
const btnCapture = document.getElementById('btnCapture');
const btnReset = document.getElementById('btnReset');
const btnCalculate = document.getElementById('btnCalculate');
const realHeightInput = document.getElementById('realHeight');

let stream = null;
let calibrationPoints = [];
let imageCaptured = false;
let capturedImageObj = null;
let graphDataset = [];
let graphScale = null;

// Constante Pi manual
const PI_MANUAL = 3.141592653589793;

// -------------------------------------------------------------
// FUNCIONES MATEMÁTICAS MANUALES
// -------------------------------------------------------------

function elevarAlCuadrado(base) {
    return base * base;
}

function valorAbsoluto(numero) {
    return numero < 0 ? -numero : numero;
}

// -------------------------------------------------------------
// VISIÓN ARTIFICIAL: AJUSTE MAGNÉTICO AL BORDE REAL
// -------------------------------------------------------------

function snapToRealEdge(xClick, yClick) {
    const searchRange = 12; // Rango de búsqueda en píxeles
    let startX = Math.max(0, Math.floor(xClick - searchRange));
    let width = searchRange * 2;
    
    let imgData;
    try {
        imgData = ctx.getImageData(startX, Math.floor(yClick), width, 1).data;
    } catch (e) {
        return xClick; // Retorno de seguridad
    }

    let maxGradient = 0;
    let bestX = xClick;

    for (let i = 0; i < imgData.length - 8; i += 4) {
        let brightnessCurrent = (imgData[i] + imgData[i + 1] + imgData[i + 2]) / 3;
        let brightnessNext = (imgData[i + 4] + imgData[i + 5] + imgData[i + 6]) / 3;
        let gradient = valorAbsoluto(brightnessNext - brightnessCurrent);

        if (gradient > maxGradient) {
            maxGradient = gradient;
            let offset = (i / 4) - searchRange;
            bestX = xClick + offset;
        }
    }

    return maxGradient > 15 ? bestX : xClick;
}

// -------------------------------------------------------------
// BÚSQUEDA DE RAÍCES: MÉTODO DE LA SECANTE
// Resuelve f(h) = V(h) - V_objetivo = 0
// -------------------------------------------------------------

function calcularVolumenHastaAltura(hEval, maxRadiusCm, realHeightCm) {
    const n = 20;
    const dz = hEval / n;
    let vParcial = 0;

    for (let i = 0; i < n; i++) {
        let z0 = i * dz;
        let z1 = (i + 1) * dz;
        
        let p0 = z0 / realHeightCm;
        let p1 = z1 / realHeightCm;

        let r0 = obtenerRadioGeometrico(p0, maxRadiusCm);
        let r1 = obtenerRadioGeometrico(p1, maxRadiusCm);

        let radioCuadradoPromedio = (elevarAlCuadrado(r0) + elevarAlCuadrado(r1)) / 2;
        vParcial += PI_MANUAL * radioCuadradoPromedio * dz;
    }
    return vParcial;
}

function obtenerRadioGeometrico(p, maxRadiusCm) {
    if (p <= 0.12) {
        // Base: curva suave de entrada desde el fondo
        return maxRadiusCm * (0.85 + 0.15 * Math.sin((p / 0.12) * (Math.PI / 2)));
    } 
    else if (p > 0.12 && p <= 0.55) {
        // Cuerpo: cintura cóncava de agarre
        let pCuerpo = (p - 0.12) / 0.43;
        return maxRadiusCm * (1 - 0.10 * Math.sin(pCuerpo * Math.PI));
    } 
    else if (p > 0.55 && p <= 0.85) {
        // Cuello: reducción parabólica
        let pCuello = (p - 0.55) / 0.30;
        let factorReduccion = 0.55;
        return maxRadiusCm * (1 - factorReduccion * Math.pow(pCuello, 1.8));
    } 
    else {
        // Boquilla y Tapa
        return maxRadiusCm * 0.45;
    }
}

function metodoSecante(vObjetivo, maxRadiusCm, realHeightCm) {
    let h0 = realHeightCm * 0.4;
    let h1 = realHeightCm * 0.9;
    let tol = 0.001;
    let maxIter = 50;
    let iter = 0;
    let hNext = h1;

    while (iter < maxIter) {
        let f_h0 = calcularVolumenHastaAltura(h0, maxRadiusCm, realHeightCm) - vObjetivo;
        let f_h1 = calcularVolumenHastaAltura(h1, maxRadiusCm, realHeightCm) - vObjetivo;

        if (valorAbsoluto(f_h1 - f_h0) < 1e-7) break;

        // Fórmula de la Secante
        hNext = h1 - (f_h1 * (h1 - h0)) / (f_h1 - f_h0);

        if (valorAbsoluto(f_h1) < tol) break;

        h0 = h1;
        h1 = hNext;
        iter++;
    }

    return { alturaLlenadoCm: hNext, iteraciones: iter };
}

// -------------------------------------------------------------
// CONTROL DE CÁMARA Y CAPTURA
// -------------------------------------------------------------

btnStartCamera.addEventListener('click', async () => {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        video.srcObject = stream;
        video.style.display = 'block';
        canvas.style.display = 'none';
        btnCapture.disabled = false;
    } catch (err) {
        alert('Error al acceder a la cámara: Asegúrate de dar permisos o usar HTTPS/localhost.');
    }
});

btnCapture.addEventListener('click', () => {
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    if (stream) {
        let tracks = stream.getTracks();
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].stop();
        }
    }
    
    video.style.display = 'none';
    canvas.style.display = 'block';
    btnCapture.disabled = true;
    imageCaptured = true;
    
    capturedImageObj = new Image();
    capturedImageObj.src = canvas.toDataURL('image/png');
});

// -------------------------------------------------------------
// CAPTURA DE 3 CLICS CON AJUSTE AUTOMÁTICO
// -------------------------------------------------------------

canvas.addEventListener('click', (e) => {
    if (!imageCaptured) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let x = (e.clientX - rect.left) * scaleX;
    let y = (e.clientY - rect.top) * scaleY;

    if (calibrationPoints.length === 2) {
        x = snapToRealEdge(x, y);
    }

    if (calibrationPoints.length < 3) {
        calibrationPoints[calibrationPoints.length] = { x: x, y: y };
        redrawCanvas();

        if (calibrationPoints.length === 3) {
            btnCalculate.disabled = false;
        }
    }
});

function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (capturedImageObj) {
        ctx.drawImage(capturedImageObj, 0, 0);
    }

    const labels = ["Tapa", "Base", "Borde Max"];
    const colors = ["#007bff", "#007bff", "#ff1744"];

    for (let i = 0; i < calibrationPoints.length; i++) {
        let pt = calibrationPoints[i];
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 7, 0, 2 * PI_MANUAL);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(labels[i], pt.x + 10, pt.y + 4);
    }

    if (calibrationPoints.length >= 2) {
        ctx.strokeStyle = 'rgba(0, 123, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(calibrationPoints[0].x, calibrationPoints[0].y);
        ctx.lineTo(calibrationPoints[1].x, calibrationPoints[1].y);
        ctx.stroke();
    }

    drawDatasetGraph();
}

function drawDatasetGraph() {
    if (graphDataset.length === 0 || !graphScale) return;

    const { centerXPixel, bottomY, pixelHeight, cmPerPixel, realHeightCm } = graphScale;
    const rightProfile = [];
    const leftProfile = [];

    for (let i = 0; i < graphDataset.length; i++) {
        const data = graphDataset[i];
        const y = bottomY - (data.z / realHeightCm) * pixelHeight;
        const radiusPixels = data.r / cmPerPixel;

        rightProfile[rightProfile.length] = { x: centerXPixel + radiusPixels, y: y };
        leftProfile[leftProfile.length] = { x: centerXPixel - radiusPixels, y: y };
    }

    ctx.save();
    ctx.strokeStyle = '#00e676';
    ctx.fillStyle = '#00e676';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;

    for (let side = 0; side < 2; side++) {
        const profile = side === 0 ? rightProfile : leftProfile;
        ctx.beginPath();
        for (let i = 0; i < profile.length; i++) {
            if (i === 0) ctx.moveTo(profile[i].x, profile[i].y);
            else ctx.lineTo(profile[i].x, profile[i].y);
        }
        ctx.stroke();

        for (let i = 0; i < profile.length; i++) {
            ctx.beginPath();
            ctx.arc(profile[i].x, profile[i].y, 4, 0, 2 * PI_MANUAL);
            ctx.fill();
        }
    }

    ctx.restore();
}

// -------------------------------------------------------------
// GRAFICAR SILUETA EN UN CANVAS DEDICADO A PARTIR DE LA TABLA
// -------------------------------------------------------------

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
        
        if (datasetTable && datasetTable.parentNode) {
            datasetTable.parentNode.insertBefore(graphCanvas, datasetTable.nextSibling);
        } else {
            document.getElementById('resultsCard').appendChild(graphCanvas);
        }
    }

    const gCtx = graphCanvas.getContext('2d');
    gCtx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);

    const padding = 30;
    const drawWidth = graphCanvas.width - (padding * 2);
    const drawHeight = graphCanvas.height - (padding * 2);
    const centerX = graphCanvas.width / 2;

    let maxR = 0;
    for (let i = 0; i < dataset.length; i++) {
        if (dataset[i].r > maxR) maxR = dataset[i].r;
    }

    const scaleX = (drawWidth / 2) / (maxR * 1.2);
    const scaleY = drawHeight / realHeightCm;

    // Eje vertical
    gCtx.strokeStyle = '#444';
    gCtx.setLineDash([4, 4]);
    gCtx.beginPath();
    gCtx.moveTo(centerX, 10);
    gCtx.lineTo(centerX, graphCanvas.height - 10);
    gCtx.stroke();
    gCtx.setLineDash([]);

    // Trazar silueta simétrica
    gCtx.beginPath();
    for (let i = 0; i < dataset.length; i++) {
        let x = centerX + (dataset[i].r * scaleX);
        let y = (graphCanvas.height - padding) - (dataset[i].z * scaleY);
        if (i === 0) gCtx.moveTo(x, y);
        else gCtx.lineTo(x, y);
    }
    
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

    // Puntos del dataset
    gCtx.fillStyle = '#ff1744';
    for (let i = 0; i < dataset.length; i++) {
        let y = (graphCanvas.height - padding) - (dataset[i].z * scaleY);
        let xR = centerX + (dataset[i].r * scaleX);
        let xL = centerX - (dataset[i].r * scaleX);

        gCtx.beginPath();
        gCtx.arc(xR, y, 3, 0, 2 * PI_MANUAL);
        gCtx.arc(xL, y, 3, 0, 2 * PI_MANUAL);
        gCtx.fill();
    }
}

btnReset.addEventListener('click', () => {
    calibrationPoints = [];
    graphDataset = [];
    graphScale = null;
    btnCalculate.disabled = true;
    document.getElementById('resultsCard').style.display = 'none';
    
    const siluetaCanvas = document.getElementById('siluetaCanvas');
    if (siluetaCanvas) siluetaCanvas.remove();
    
    redrawCanvas();
});

// -------------------------------------------------------------
// MOTOR DE CÁLCULO NUMÉRICO
// -------------------------------------------------------------

btnCalculate.addEventListener('click', () => {
    if (calibrationPoints.length < 3) return;

    const realHeightCm = parseFloat(realHeightInput.value) || 15.0;

    const topPt = calibrationPoints[0];
    const bottomPt = calibrationPoints[1];
    const maxRadiusPt = calibrationPoints[2];

    const pixelHeight = valorAbsoluto(bottomPt.y - topPt.y);
    const cmPerPixel = realHeightCm / pixelHeight;

    const centerXPixel = (topPt.x + bottomPt.x) / 2;
    const maxRadiusCm = valorAbsoluto(maxRadiusPt.x - centerXPixel) * cmPerPixel;

    graphScale = {
        centerXPixel: centerXPixel,
        bottomY: bottomPt.y,
        pixelHeight: pixelHeight,
        cmPerPixel: cmPerPixel,
        realHeightCm: realHeightCm
    };

    // 1. Discretización con 20 nodos y función por tramos
    const n = 20;
    const dz = realHeightCm / n;
    let dataset = [];

    for (let i = 0; i <= n; i++) {
        let z_i = i * dz;
        let porcentajeAltura = z_i / realHeightCm;
        let r_i = obtenerRadioGeometrico(porcentajeAltura, maxRadiusCm);

        dataset[dataset.length] = { z: z_i, r: r_i };
    }

    graphDataset = dataset;

    // 2. Integración Numérica por Regla del Trapecio
    let volumeCm3 = 0;
    for (let i = 0; i < dataset.length - 1; i++) {
        let z0 = dataset[i].z;
        let z1 = dataset[i + 1].z;
        let r0 = dataset[i].r;
        let r1 = dataset[i + 1].r;

        let deltaZ = z1 - z0;
        let radioCuadradoPromedio = (elevarAlCuadrado(r0) + elevarAlCuadrado(r1)) / 2;
        let volumenSegmento = PI_MANUAL * radioCuadradoPromedio * deltaZ;

        volumeCm3 += volumenSegmento;
    }

    // 3. Búsqueda de Raíces por Método de la Secante
    const vObjetivo = 250.0;
    const secanteRes = metodoSecante(vObjetivo, maxRadiusCm, realHeightCm);

    // Renderizar Resultados en el DOM
    document.getElementById('volResult').textContent = volumeCm3.toFixed(2);
    document.getElementById('pointsCount').textContent = dataset.length;

    const secanteEl = document.getElementById('secanteResult');
    if (secanteEl) {
        secanteEl.textContent = `Altura para ${vObjetivo} mL: ${secanteRes.alturaLlenadoCm.toFixed(2)} cm (Iteraciones: ${secanteRes.iteraciones})`;
    }

    // Poblar la tabla HTML
    const tbody = document.querySelector('#datasetTable tbody');
    tbody.innerHTML = '';
    for (let i = 0; i < dataset.length; i++) {
        let data = dataset[i];
        let row = '<tr>' +
            '<td>' + (i + 1) + '</td>' +
            '<td>' + data.z.toFixed(2) + '</td>' +
            '<td>' + data.r.toFixed(2) + '</td>' +
        '</tr>';
        tbody.innerHTML += row;
    }

    document.getElementById('resultsCard').style.display = 'block';

    redrawCanvas();
    graficarSiluetaDesdeTabla(dataset, realHeightCm);
});