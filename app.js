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
    const n = 12;
    const dz = hEval / n;
    let vParcial = 0;

    for (let i = 0; i < n; i++) {
        let z0 = i * dz;
        let z1 = (i + 1) * dz;
        
        let p0 = z0 / realHeightCm;
        let p1 = z1 / realHeightCm;

        let r0 = p0 > 0.80 ? maxRadiusCm * (1 - ((p0 - 0.80) / 0.20) * 0.25) : maxRadiusCm;
        let r1 = p1 > 0.80 ? maxRadiusCm * (1 - ((p1 - 0.80) / 0.20) * 0.25) : maxRadiusCm;

        let radioCuadradoPromedio = (elevarAlCuadrado(r0) + elevarAlCuadrado(r1)) / 2;
        vParcial += PI_MANUAL * radioCuadradoPromedio * dz;
    }
    return vParcial;
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
}

btnReset.addEventListener('click', () => {
    calibrationPoints = [];
    btnCalculate.disabled = true;
    document.getElementById('resultsCard').style.display = 'none';
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

    // 1. Integración por Regla del Trapecio
    const n = 12;
    const dz = realHeightCm / n;
    let dataset = [];

    for (let i = 0; i <= n; i++) {
        let z_i = i * dz;
        let porcentajeAltura = z_i / realHeightCm;
        let r_i = maxRadiusCm;

        if (porcentajeAltura > 0.80) {
            let factorCuello = 1 - ((porcentajeAltura - 0.80) / 0.20) * 0.25;
            r_i = maxRadiusCm * factorCuello;
        }

        dataset[dataset.length] = { z: z_i, r: r_i };
    }

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

    // 2. Búsqueda de Raíces por Método de la Secante
    const vObjetivo = 250.0; // Volumen nominal objetivo (mL)
    const secanteRes = metodoSecante(vObjetivo, maxRadiusCm, realHeightCm);

    // Renderizar Resultados
    document.getElementById('volResult').textContent = volumeCm3.toFixed(2);
    document.getElementById('pointsCount').textContent = dataset.length;

    // Si agregas estos elementos opcionales en el HTML, mostrarán la Secante:
    const secanteEl = document.getElementById('secanteResult');
    if (secanteEl) {
        secanteEl.textContent = `Altura para ${vObjetivo} mL: ${secanteRes.alturaLlenadoCm.toFixed(2)} cm (Iteraciones: ${secanteRes.iteraciones})`;
    }

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
});