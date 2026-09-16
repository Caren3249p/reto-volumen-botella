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

// Constante Pi manual (sin Math.PI)
const PI_MANUAL = 3.141592653589793;

// -------------------------------------------------------------
// FUNCIONES MATEMÁTICAS MANUALES (SIN LIBRERÍAS)
// -------------------------------------------------------------

function elevarAlCuadrado(base) {
    return base * base;
}

function valorAbsoluto(numero) {
    return numero < 0 ? -numero : numero;
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
// CAPTURA DE 3 CLICS Y DIBUJO EN CANVAS
// -------------------------------------------------------------

canvas.addEventListener('click', (e) => {
    if (!imageCaptured) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

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

    // Dibujar los 3 clics de referencia
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

    // Trazar Eje Central de simetría
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
// MOTOR DE INTEGRACIÓN NUMÉRICA (TRAPECIO COMPUESTO)
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

    // Discretización en n=12 nodos con perfil ajustado
    const n = 12;
    const dz = realHeightCm / n;
    let dataset = [];

    for (let i = 0; i <= n; i++) {
        let z_i = i * dz;
        let porcentajeAltura = z_i / realHeightCm;
        let r_i = maxRadiusCm;

        // Mantiene el radio cilíndrico completo hasta el 80% de la altura.
        // Solo reduce en el 20% superior para modelar la zona del cuello.
        if (porcentajeAltura > 0.80) {
            let factorCuello = 1 - ((porcentajeAltura - 0.80) / 0.20) * 0.38;
            r_i = maxRadiusCm * factorCuello;
        }

        dataset[dataset.length] = { z: z_i, r: r_i };
    }

    // Integración por Regla del Trapecio
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

    // Renderizar Resultados
    document.getElementById('volResult').textContent = volumeCm3.toFixed(2);
    document.getElementById('pointsCount').textContent = dataset.length;

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