let calibrationPoints = [];

canvas.addEventListener('click', (e) => {
    if (!imageCaptured) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Solo se requieren 3 clics exactos
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

    // Dibujar Puntos Clave
    const labels = ["Tapa", "Base", "Borde Max"];
    const colors = ["#007bff", "#007bff", "#ff1744"];

    for (let i = 0; i < calibrationPoints.length; i++) {
        let pt = calibrationPoints[i];
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 7, 0, 2 * PI_MANUAL);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.font = "12px sans-serif";
        ctx.fillText(labels[i], pt.x + 10, pt.y + 4);
    }

    // Trazar Eje Central entre Tapa y Base (Si existen 2 clics)
    if (calibrationPoints.length >= 2) {
        ctx.strokeStyle = 'rgba(0, 123, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(calibrationPoints[0].x, calibrationPoints[0].y);
        ctx.lineTo(calibrationPoints[1].x, calibrationPoints[1].y);
        ctx.stroke();
    }
}

btnReset.addEventListener('click', () => {
    points = [];
    calibrationPoints = [];
    btnCalculate.disabled = true;
    document.getElementById('resultsCard').style.display = 'none';
    redrawCanvas();
});

btnCalculate.addEventListener('click', () => {
    if (calibrationPoints.length < 3) return;

    const realHeightCm = parseFloat(realHeightInput.value);

    // 1. Calibración del Eje Vertical
    const topPt = calibrationPoints[0];
    const bottomPt = calibrationPoints[1];
    const maxRadiusPt = calibrationPoints[2];

    const pixelHeight = valorAbsoluto(bottomPt.y - topPt.y);
    const cmPerPixel = realHeightCm / pixelHeight;

    // Eje X promedio
    const centerXPixel = (topPt.x + bottomPt.x) / 2;

    // Radio máximo en cm
    const maxRadiusCm = valorAbsoluto(maxRadiusPt.x - centerXPixel) * cmPerPixel;

    // 2. Generación del Dataset Discretizado (Perfil Cilíndrico con Estrechamiento de Cuello)
    // Se divide la altura en n=12 nodos para aplicar el Trapecio
    const n = 12;
    const dz = realHeightCm / n;
    let dataset = [];

    for (let i = 0; i <= n; i++) {
        let z_i = i * dz;
        let porcentajeAltura = z_i / realHeightCm;
        let r_i = maxRadiusCm;

        // Modelado de la botella: cuerpo uniforme y estrechamiento progresivo hacia la tapa
        if (porcentajeAltura > 0.65) {
            let factorCuello = 1 - ((porcentajeAltura - 0.65) / 0.35) * 0.55;
            r_i = maxRadiusCm * factorCuello;
        }

        dataset[dataset.length] = { z: z_i, r: r_i };
    }

    // 3. Integración Numérica (Regla del Trapecio Compuesto)
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