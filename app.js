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
let points = [];
let imageCaptured = false;
let capturedImageObj = null;

// Constante Pi manual (sin Math.PI)
const PI_MANUAL = 3.141592653589793;

// -------------------------------------------------------------
// FUNCIONES MATEMÁTICAS Y ALGORITMOS DESDE CERO (SIN LIBRERÍAS)
// -------------------------------------------------------------

// Elevación al cuadrado manual (reemplaza a Math.pow(x, 2))
function elevarAlCuadrado(base) {
    return base * base;
}

// Valor absoluto manual (reemplaza a Math.abs)
function valorAbsoluto(numero) {
    return numero < 0 ? -numero : numero;
}

// Algoritmo de Ordenamiento Burbuja / Bubble Sort (reemplaza a .sort())
// Ordena el arreglo de puntos de menor a mayor altura z
function ordenarPuntosPorZ(arreglo) {
    let n = arreglo.length;
    for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < n - i - 1; j++) {
            if (arreglo[j].z > arreglo[j + 1].z) {
                // Intercambio (Swap)
                let temp = arreglo[j];
                arreglo[j] = arreglo[j + 1];
                arreglo[j + 1] = temp;
            }
        }
    }
    return arreglo;
}

// -------------------------------------------------------------
// EVENTOS Y LÓGICA DE INTERFAZ
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
        alert('Error al acceder a la cámara: ' + err.message);
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

canvas.addEventListener('click', (e) => {
    if (!imageCaptured) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Agregar punto manualmente
    points[points.length] = { x: x, y: y };
    redrawCanvas();

    if (points.length >= 2) {
        btnCalculate.disabled = false;
    }
});

function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (capturedImageObj) {
        ctx.drawImage(capturedImageObj, 0, 0);
    }

    ctx.fillStyle = 'red';
    ctx.strokeStyle = 'cyan';
    ctx.lineWidth = 2;

    for (let i = 0; i < points.length; i++) {
        let pt = points[i];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5, 0, 2 * PI_MANUAL);
        ctx.fill();

        if (i === 0) {
            ctx.moveTo(pt.x, pt.y);
        } else {
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
        }
    }
}

btnReset.addEventListener('click', () => {
    points = [];
    btnCalculate.disabled = true;
    document.getElementById('resultsCard').style.display = 'none';
    redrawCanvas();
});

// -------------------------------------------------------------
// MOTOR DE INTEGRACIÓN NUMÉRICA PROPIO
// -------------------------------------------------------------

btnCalculate.addEventListener('click', () => {
    if (points.length < 2) return;

    const realHeightCm = parseFloat(realHeightInput.value);

    // 1. Encontrar Y mínima y Y máxima manualmente (sin Math.min / Math.max)
    let minYPixel = points[0].y;
    let maxYPixel = points[0].y;
    let minXPixel = points[0].x;

    for (let i = 1; i < points.length; i++) {
        if (points[i].y < minYPixel) minYPixel = points[i].y;
        if (points[i].y > maxYPixel) maxYPixel = points[i].y;
        if (points[i].x < minXPixel) minXPixel = points[i].x;
    }

    // 2. Factor de conversión píxel -> cm
    const pixelHeight = valorAbsoluto(maxYPixel - minYPixel);
    const cmPerPixel = realHeightCm / pixelHeight;

    // 3. Mapeo del Dataset a coordenadas reales (z_i, r_i)
    let dataset = [];
    for (let i = 0; i < points.length; i++) {
        let z_i = (maxYPixel - points[i].y) * cmPerPixel;
        let r_i = valorAbsoluto(points[i].x - minXPixel) * cmPerPixel;
        dataset[dataset.length] = { z: z_i, r: r_i };
    }

    // 4. Ordenamiento numérico manual del dataset por altura z (Bubble Sort)
    dataset = ordenarPuntosPorZ(dataset);

    // 5. Integración Numérica por Trapecio Compuesto (Método de Discos)
    // Formula: V = PI * sum( ((r_i^2 + r_{i+1}^2) / 2) * (z_{i+1} - z_i) )
    let volumeCm3 = 0;
    for (let i = 0; i < dataset.length - 1; i++) {
        let z0 = dataset[i].z;
        let z1 = dataset[i + 1].z;
        let r0 = dataset[i].r;
        let r1 = dataset[i + 1].r;

        let dz = z1 - z0;
        let radioCuadradoPromedio = (elevarAlCuadrado(r0) + elevarAlCuadrado(r1)) / 2;
        let volumenSegmento = PI_MANUAL * radioCuadradoPromedio * dz;
        
        volumeCm3 += volumenSegmento;
    }

    // Renderizar resultados en pantalla
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