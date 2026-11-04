function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

export async function convertOrResizeImage(file, { format = 'image/png', maxWidth = 0, quality = 0.88 } = {}) {
  const img = await loadImage(file);
  const scale = maxWidth && img.width > maxWidth ? maxWidth / img.width : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, format, quality));
  if (!blob) throw new Error('This image could not be converted.');
  const ext = format.split('/')[1].replace('jpeg', 'jpg');
  const base = file.name.replace(/\.[^.]+$/, '');
  downloadBlob(blob, `${base}-converted.${ext}`);
}

export async function removeImageBackground(file) {
  // The @imgly package runs background removal in the browser.
  // Review its AGPL/commercial licensing terms before public/commercial deployment.
  const { removeBackground } = await import('@imgly/background-removal');
  const result = await removeBackground(file);
  const base = file.name.replace(/\.[^.]+$/, '');
  downloadBlob(result, `${base}-no-background.png`);
}
