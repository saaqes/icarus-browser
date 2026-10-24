/**
 * Dominio registrable (eTLD+1) aproximado, usado para distinguir solicitudes
 * de terceros. No incluye la Public Suffix List completa: cubre los sufijos de
 * dos niveles más habituales. Ver docs/SHIELD.md.
 */

const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'net.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'org.mx', 'gob.mx',
  'com.ar', 'gob.ar', 'com.co', 'gov.co', 'com.pe', 'gob.pe', 'com.ve', 'com.uy', 'com.ec', 'gob.ec', 'cl.cl',
  'com.es', 'org.es', 'gob.es', 'nom.es', 'edu.es',
  'com.tr', 'com.cn', 'com.hk', 'com.tw', 'com.sg', 'com.my', 'co.in', 'co.id', 'co.za', 'co.il', 'com.ua',
  'github.io', 'gitlab.io', 'blogspot.com', 'herokuapp.com', 'netlify.app', 'vercel.app', 'pages.dev',
  'azurewebsites.net', 'cloudfront.net', 'appspot.com', 'web.app', 'firebaseapp.com',
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function getRegistrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || IPV4.test(host) || host.includes(':') || host.startsWith('[')) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

export function isThirdParty(requestHost: string, pageHost: string): boolean {
  if (!pageHost) return false;
  return getRegistrableDomain(requestHost) !== getRegistrableDomain(pageHost);
}

/** ¿Es `host` igual a `domain` o un subdominio suyo? */
export function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
