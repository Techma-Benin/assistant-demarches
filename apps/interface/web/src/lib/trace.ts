function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** W3C traceparent v00 ; trace and span are never all zeros. */
export function newTraceparent(): string {
  let trace = randomHex(16);
  while (/^0+$/.test(trace)) trace = randomHex(16);
  let span = randomHex(8);
  while (/^0+$/.test(span)) span = randomHex(8);
  return `00-${trace}-${span}-01`;
}
