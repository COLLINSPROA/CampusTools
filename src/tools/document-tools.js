import mammoth from 'mammoth/mammoth.browser';
import * as XLSX from 'xlsx';
import { textToPdf } from './pdf-tools.js';

export async function docxToText(file) {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const blob = new Blob([result.value], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, file.name.replace(/\.docx$/i, '') + '.txt');
}

export async function docxToPdfTextOnly(file) {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  await textToPdf(result.value);
}

export async function spreadsheetToCsv(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheet]);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    file.name.replace(/\.[^.]+$/, '') + '.csv');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
