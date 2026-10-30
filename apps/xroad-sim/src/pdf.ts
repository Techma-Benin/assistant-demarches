/** One-page PDF, Helvetica, WinAnsi: enough for a document that says it is a simulation. */
export function simulatedPdf(title: string, lines: string[]): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\xff]/g, '?');
  const text = [
    'BT /F1 9 Tf 72 790 Td (SIMULATION - SANS VALEUR ADMINISTRATIVE) Tj ET',
    `BT /F1 18 Tf 72 740 Td (${escape(title)}) Tj ET`,
    ...lines.map((line, index) => `BT /F1 11 Tf 72 ${700 - index * 18} Td (${escape(line)}) Tj ET`),
  ].join('\n');
  const content = Buffer.from(text, 'latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let length = chunks[0].length;
  const push = (chunk: Buffer) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  objects.forEach((body, index) => {
    offsets.push(length);
    push(Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1'));
  });
  offsets.push(length);
  push(Buffer.concat([Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream\nendobj\n', 'latin1')]));

  const xref = length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  push(Buffer.from(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}
