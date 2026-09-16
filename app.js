// Variable para guardar los puntos de calibración
let calibrationPoints = [];

canvas.addEventListener('click', (e) => {
    if (!imageCaptured) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Clic 1: Tapa (Punto superior)
    // Clic 2: Base (Punto inferior)
    if (calibrationPoints.length < 2) {
        calibrationPoints[calibrationPoints.length] = { x: x, y: y };
        redrawCanvas();
        if (calibrationPoints.length === 2) {
            alert("¡Calibración lista! Ahora marca los puntos a lo largo del borde lateral derecho.");
        }
        return;
    }

    // A partir del Clic 3: Puntos del perfil lateral
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

    // 1. Dibujar Puntos de Calibración (Azules) y Eje Central
    for (let i = 0; i < calibrationPoints.length; i++) {
        let pt = calibrationPoints[i];
        ctx.fillStyle = '#007bff';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 7, 0, 2 * PI_MANUAL);
        ctx.fill();
    }

    // Si existen los 2 puntos de calibración, trazar la línea central de referencia
    if (calibrationPoints.length === 2) {
        ctx.strokeStyle = 'rgba(0, 123, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(calibrationPoints[0].x, calibrationPoints[0].y);
        ctx.lineTo(calibrationPoints[1].x, calibrationPoints[1].y);
        ctx.stroke();
    }

    // 2. Dibujar Puntos del Contorno (Rojos) y la curva trazada (Cian)
    if (points.length > 0) {
        ctx.strokeStyle = 'cyan';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        for (let i = 0; i < points.length; i++) {
            let pt = points[i];
            if (i === 0) {
                ctx.moveTo(pt.x, pt.y);
            } else {
                ctx.lineTo(pt.x, pt.y);
            }
        }
        ctx.stroke();

        ctx.fillStyle = 'red';
        for (let i = 0; i < points.length; i++) {
            let pt = points[i];
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 5, 0, 2 * PI_MANUAL);
            ctx.fill();
        }
    }
}

// Reiniciar ambos arreglos de puntos
btnReset.addEventListener('click', () => {
    points = [];
    calibrationPoints = [];
    btnCalculate.disabled = true;
    document.getElementById('resultsCard').style.display = 'none';
    redrawCanvas();
});

btnCalculate.addEventListener('click', () => {
    if (points.length < 2 || calibrationPoints.length < 2) return;

    const realHeightCm = parseFloat(realHeightInput.value);

    // 1. Calibración exacta de altura axial
    const topPixelY = calibrationPoints[0].y;
    const bottomPixelY = calibrationPoints[1].y;
    const pixelHeight = valorAbsoluto(bottomPixelY - topPixelY);

    const cmPerPixel = realHeightCm / pixelHeight;

    // Eje central promedio entre la tapa y la base
    const centerXPixel = (calibrationPoints[0].x + calibrationPoints[1].x) / 2;

    // 2. Mapeo a coordenadas físicas (z_i, r_i)
    let dataset = [];
    for (let i = 0; i < points.length; i++) {
        let z_i = valorAbsoluto(bottomPixelY - points[i].y) * cmPerPixel;
        let r_i = valorAbsoluto(points[i].x - centerXPixel) * cmPerPixel;
        dataset[dataset.length] = { z: z_i, r: r_i };
    }

    // 3. Ordenamiento del dataset por nodo z_i (Bubble Sort)
    dataset = ordenarPuntosPorZ(dataset);

    // 4. Integración Numérica por Trapecio (Discos de revolución)
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

    // Renderizado de tabla y resultado final
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