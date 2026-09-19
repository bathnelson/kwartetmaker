// Minimale PDF-schrijver: elke pagina is één JPEG op A4-formaat. Genoeg voor
// printvellen, en het houdt de maten exact (geen "passend maken" van de printer).
const A4_W = 595.276;   // 210 mm in punten
const A4_H = 841.890;   // 297 mm

const enc = new TextEncoder();

/**
 * @param {{data: Uint8Array, width: number, height: number}[]} pages JPEG per pagina
 * @returns {Blob}
 */
export function makePdf(pages) {
  const chunks = [];
  let len = 0;
  const offsets = [];

  const put = (x) => {
    const bytes = typeof x === 'string' ? enc.encode(x) : x;
    chunks.push(bytes);
    len += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = len;
    put(`${n} 0 obj\n`);
    put(body);
    put('\nendobj\n');
  };

  put('%PDF-1.4\n');
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));   // "binair" markeren

  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  pages.forEach((page, i) => {
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const stream = `q ${A4_W.toFixed(3)} 0 0 ${A4_H.toFixed(3)} 0 0 cm /Im0 Do Q`;

    obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W.toFixed(3)} ${A4_H.toFixed(3)}] `
      + `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    obj(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

    offsets[imageId] = len;
    put(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>\nstream\n`);
    put(page.data);
    put('\nendstream\nendobj\n');
  });

  const count = 3 + pages.length * 3;
  const xref = len;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) {
    table += String(offsets[n] || 0).padStart(10, '0') + ' 00000 n \n';
  }
  put(table);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}

export const PAGE = { width: A4_W, height: A4_H };
