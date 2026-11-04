function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function imagesToPdf(files) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const image = file.type === 'image/png'
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  downloadBlob(new Blob([await pdf.save()], { type: 'application/pdf' }), 'images.pdf');
}

export async function mergePdfs(files) {
  const { PDFDocument } = await import('pdf-lib');
  const output = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer());
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
  }
  downloadBlob(new Blob([await output.save()], { type: 'application/pdf' }), 'merged.pdf');
}

export async function splitPdf(file, rangeText) {
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(await file.arrayBuffer());
  const indexes = parsePageRange(rangeText, source.getPageCount());
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, indexes);
  pages.forEach(page => output.addPage(page));
  downloadBlob(new Blob([await output.save()], { type: 'application/pdf' }), 'selected-pages.pdf');
}

function parsePageRange(value, total) {
  const indexes = new Set();
  for (const part of value.split(',').map(v => v.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Use page numbers such as 1-3,5.');
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > total) throw new Error(`Page range must be between 1 and ${total}.`);
    for (let page = start; page <= end; page++) indexes.add(page - 1);
  }
  if (!indexes.size) throw new Error('Enter at least one page number.');
  return [...indexes].sort((a, b) => a - b);
}

export async function textToPdf(text) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageWidth = 595.28, pageHeight = 841.89, margin = 48, fontSize = 11;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const maxChars = 95;
  const lines = text.split(/\r?\n/).flatMap(line => {
    const chunks = [];
    for (let i = 0; i < line.length; i += maxChars) chunks.push(line.slice(i, i + maxChars));
    return chunks.length ? chunks : [''];
  });
  for (const line of lines) {
    if (y < margin) { page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - margin; }
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.12, 0.16, 0.22) });
    y -= 16;
  }
  downloadBlob(new Blob([await pdf.save()], { type: 'application/pdf' }), 'text-document.pdf');
}

export async function pdfToImages(file) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    downloadBlob(blob, `page-${pageNo}.png`);
  }
}
