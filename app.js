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
        stream.getTracks().forEach(track => track.stop());
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

    points.push({ x, y });
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

    ctx.beginPath();
    points.forEach((pt, index) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5, 0, 2 * Math.PI);
        ctx.fill();

        if (index === 0) {
            ctx.moveTo(pt.x, pt.y);
        } else {
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
        }
    });
}

btnReset.addEventListener('click', () => {
    points = [];
    btnCalculate.disabled = true;
    document.getElementById('resultsCard').style.display = 'none';
    redrawCanvas();
});

btnCalculate.addEventListener('click', () => {
    if (points.length < 2) return;

    const realHeightCm = parseFloat(realHeightInput.value);

    const yValues = points.map(p => p.y);
    const minYPixel = Math.min(...yValues);
    const maxYPixel = Math.max(...yValues);
    const pixelHeight = Math.abs(maxYPixel - minYPixel);

    const cmPerPixel = realHeightCm / pixelHeight;
    const xMinPixel = Math.min(...points.map(p => p.x));

    let dataset = points.map(pt => {
        const z = (maxYPixel - pt.y) * cmPerPixel;
        const r = Math.abs(pt.x - xMinPixel) * cmPerPixel;
        return { z, r };
    }).sort((a, b) => a.z - b.z);

    let volumeCm3 = 0;
    for (let i = 0; i < dataset.length - 1; i++) {
        const z0 = dataset[i].z;
        const z1 = dataset[i + 1].z;
        const r0 = dataset[i].r;
        const r1 = dataset[i + 1].r;

        const dz = z1 - z0;
        const segmentVolume = Math.PI * ((Math.pow(r0, 2) + Math.pow(r1, 2)) / 2) * dz;
        volumeCm3 += segmentVolume;
    }

    document.getElementById('volResult').textContent = volumeCm3.toFixed(2);
    document.getElementById('pointsCount').textContent = dataset.length;
    
    const tbody = document.querySelector('#datasetTable tbody');
    tbody.innerHTML = '';
    dataset.forEach((data, index) => {
        const row = `<tr>
            <td>${index + 1}</td>
            <td>${data.z.toFixed(2)}</td>
            <td>${data.r.toFixed(2)}</td>
        </tr>`;
        tbody.innerHTML += row;
    });

    document.getElementById('resultsCard').style.display = 'block';
});