/** Full page navigation (login redirect); a seam so tests can observe it. */
export function navigate(url: string): void {
  window.location.assign(url);
}
