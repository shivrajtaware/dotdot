import { Capacitor } from '@capacitor/core';

const PDF_WIDTH_MM = 190;
const PDF_IMAGE_HEIGHT_MM = 270;
const PAGE_MARGIN_MM = 10;
const CAPTURE_WIDTH_PX = 760;

type CapturePage = { start: number; end: number };

function paginateCanvas(canvas: HTMLCanvasElement, element: HTMLElement): CapturePage[] {
  const maxPagePixels = Math.floor((PDF_IMAGE_HEIGHT_MM * canvas.width) / PDF_WIDTH_MM);
  const scale = canvas.width / element.getBoundingClientRect().width;
  const breakCandidates = Array.from(element.children)
    .map(child => Math.round((child.getBoundingClientRect().top - element.getBoundingClientRect().top) * scale))
    .filter(value => value > 0 && value < canvas.height)
    .sort((a, b) => a - b);
  const pages: CapturePage[] = [];
  let start = 0;
  while (start < canvas.height) {
    const hardEnd = Math.min(canvas.height, start + maxPagePixels);
    if (hardEnd === canvas.height) {
      pages.push({ start, end: hardEnd });
      break;
    }
    const earliestBreak = start + Math.floor(maxPagePixels * 0.55);
    const sectionBoundary = breakCandidates.filter(value => value >= earliestBreak && value <= hardEnd).at(-1);
    const end = sectionBoundary ?? hardEnd;
    pages.push({ start, end });
    start = end;
  }
  return pages;
}

async function waitForImages(element: HTMLElement) {
  await Promise.all(Array.from(element.querySelectorAll('img')).map(async image => {
    if (!image.complete) await new Promise<void>(resolve => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
    if (image.complete && image.naturalWidth > 0 && typeof image.decode === 'function') await image.decode().catch(() => {});
  }));
}

export async function buildRegisterPdf(source: HTMLElement): Promise<Blob> {
  const [canvasModule, pdfModule] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const html2canvas = canvasModule.default;
  const { jsPDF } = pdfModule;
  await document.fonts?.ready;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${CAPTURE_WIDTH_PX}px;z-index:-1;pointer-events:none;background:#fff;`;
  const register = source.cloneNode(true) as HTMLElement;
  register.style.cssText += `;display:block;width:${CAPTURE_WIDTH_PX}px;max-width:none;margin:0;padding:20px;background:#fff;box-shadow:none;border:0;`;
  register.querySelectorAll<HTMLElement>('.table-wrap').forEach(el => { el.style.overflow = 'visible'; });
  register.querySelectorAll('.signature-pad, button').forEach(el => el.remove());
  host.append(register);
  document.body.append(host);
  try {
    await waitForImages(register);
    const canvas = await html2canvas(register, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      windowWidth: CAPTURE_WIDTH_PX,
      width: CAPTURE_WIDTH_PX,
      onclone: cloned => {
        const clonedRegister = cloned.querySelector('.register-print') as HTMLElement | null;
        if (clonedRegister) { clonedRegister.style.width = `${CAPTURE_WIDTH_PX}px`; clonedRegister.style.maxWidth = 'none'; }
      }
    });
    const pages = paginateCanvas(canvas, register);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pages.forEach((page, index) => {
      if (index > 0) pdf.addPage();
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = page.end - page.start;
      const context = pageCanvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the PDF page.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(canvas, 0, page.start, canvas.width, pageCanvas.height, 0, 0, pageCanvas.width, pageCanvas.height);
      const heightMm = pageCanvas.height * PDF_WIDTH_MM / canvas.width;
      pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.94), 'JPEG', PAGE_MARGIN_MM, PAGE_MARGIN_MM, PDF_WIDTH_MM, heightMm, undefined, 'FAST');
      pdf.setFontSize(8);
      pdf.setTextColor(95, 105, 96);
      pdf.text(`Krushinath Green Energy · Page ${index + 1} of ${pages.length}`, 105, 291, { align: 'center' });
      pageCanvas.width = 1;
      pageCanvas.height = 1;
    });
    return pdf.output('blob');
  } finally {
    host.remove();
  }
}

export async function downloadRegisterPdf(source: HTMLElement, filename: string): Promise<'downloaded' | 'shared'> {
  const blob = await buildRegisterPdf(source);
  const safeFilename = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
  if (Capacitor.isNativePlatform()) {
    const file = new File([blob], safeFilename, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: safeFilename, files: [file] });
      return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
