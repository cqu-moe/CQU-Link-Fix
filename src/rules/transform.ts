import type { Transformer } from './types';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const ATRUST_SUFFIX = '.atrust.cqu.edu.cn';
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function parseHttpUrl(input: string): URL {
  const url = new URL(input);
  if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password) {
    throw new Error('unsupported URL');
  }
  return url;
}

export function isAtrustUrl(input: string): boolean {
  return parseHttpUrl(input).hostname.toLowerCase().endsWith(ATRUST_SUFFIX);
}

export function isCquDomain(input: string): boolean {
  const host = parseHttpUrl(input).hostname.toLowerCase();
  return host === 'cqu.edu.cn' || host.endsWith('.cqu.edu.cn');
}

export function toAtrustDomainUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (url.hostname.toLowerCase().endsWith(ATRUST_SUFFIX)) throw new Error('URL already uses aTrust');
  if (url.port) throw new Error('domain transform does not accept a non-default port');
  url.protocol = 'https:';
  url.hostname = `${url.hostname.toLowerCase().replaceAll('.', '-')}-s.atrust.cqu.edu.cn`;
  return url.toString();
}

export function toAtrustIpPortUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (!IPV4.test(url.hostname) || !url.port) throw new Error('complete IPv4 and port required');
  const octets = url.hostname.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) throw new Error('invalid IPv4');
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  url.protocol = 'https:';
  url.hostname = `${url.hostname.replaceAll('.', '-')}-${port}-p.atrust.cqu.edu.cn`;
  url.port = '';
  return url.toString();
}

export function toYouthPublicUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (url.hostname.toLowerCase() !== 'youth.cqu.edu.cn') throw new Error('not a Youth League URL');
  const match = /^\/info\/(\d+)\/(\d+)\.htm$/.exec(url.pathname);
  if (!match) throw new Error('not a Youth League article');
  const [, wbtreeid, wbnewsid] = match;
  url.pathname = '/content.jsp';
  url.search = new URLSearchParams({
    urltype: 'news.NewsContentUrl',
    wbtreeid: wbtreeid!,
    wbnewsid: wbnewsid!,
  }).toString();
  return url.toString();
}

export function assertCasServicePreserved(before: string, after: string): void {
  const beforeService = parseHttpUrl(before).searchParams.get('service');
  const afterService = parseHttpUrl(after).searchParams.get('service');
  if (beforeService !== afterService) throw new Error('CAS service changed during rewrite');
}

export function applyTransformer(transformer: Transformer, input: string): string {
  if (transformer === 'atrust-domain') return toAtrustDomainUrl(input);
  if (transformer === 'atrust-ip-port') return toAtrustIpPortUrl(input);
  return toYouthPublicUrl(input);
}
