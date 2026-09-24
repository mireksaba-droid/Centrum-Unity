/**
 * Bezpečně ověří, zda aplikace běží v náhledovém/vývojovém prostředí (např. Google Cloud Run, AI Studio, StackBlitz, IDX, localhost),
 * kde je vyžadován HashRouter nebo hash routing.
 * 
 * Využívá striktní ověření domén pomocí endsWith nebo přesné shody pro eliminaci SSRF a CodeQL varování (js/incomplete-url-substring-sanitization).
 */
export function isPreviewEnvironment(): boolean {
  if (typeof window === 'undefined' || !window.location || !window.location.hostname) {
    return false;
  }
  const hostname = window.location.hostname.toLowerCase();
  return (
    hostname.endsWith('.usercontent.goog') ||
    hostname === 'usercontent.goog' ||
    hostname.endsWith('.webcontainer.io') ||
    hostname === 'webcontainer.io' ||
    hostname.endsWith('.idx.google.com') ||
    hostname === 'idx.google.com' ||
    hostname.endsWith('.run.app') ||
    hostname === 'run.app' ||
    hostname.endsWith('.google.dev') ||
    hostname === 'google.dev' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  );
}
