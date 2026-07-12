import type { Transformer } from './types';
import { normalizeDnsHost } from './custom-rule-policy';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const ATRUST_SUFFIX = '.atrust.cqu.edu.cn';
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const YOUTH_PARAMETERS = new Set(['urltype', 'wbtreeid', 'wbnewsid']);
const DECIMAL_OCTET = '(?:0|[1-9]\\d{0,2})';
const RAW_IPV4_PORT = new RegExp(
  `^https?://(${DECIMAL_OCTET}(?:\\.${DECIMAL_OCTET}){3}):(\\d+)(?=[/?#]|$)`,
  'i',
);

function parseHttpUrl(input: string): URL {
  const url = new URL(input);
  if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password) {
    throw new Error('unsupported URL');
  }
  return url;
}

function isDnsHostname(host: string): boolean {
  return host.includes('.') && normalizeDnsHost(host) === host.toLowerCase();
}

function queryParameterName(segment: string): string {
  const equals = segment.indexOf('=');
  const rawName = equals === -1 ? segment : segment.slice(0, equals);
  return new URLSearchParams(`${rawName}=`).keys().next().value ?? '';
}

export function isAtrustUrl(input: string): boolean {
  return parseHttpUrl(input).hostname.toLowerCase().endsWith(ATRUST_SUFFIX);
}

export function isCquDomain(input: string): boolean {
  const host = parseHttpUrl(input).hostname.toLowerCase();
  return host === 'cqu.edu.cn' || host.endsWith('.cqu.edu.cn');
}

export function hasTopLevelCasTicket(url: URL): boolean {
  return url.searchParams.has('ticket');
}

export function toAtrustDomainUrl(input: string): string {
  const url = parseHttpUrl(input);
  const host = url.hostname.toLowerCase();
  if (host.endsWith(ATRUST_SUFFIX)) throw new Error('URL already uses aTrust');
  if (IPV4.test(host) || !isDnsHostname(host)) throw new Error('domain transform requires a DNS hostname');
  if (url.port) throw new Error('domain transform does not accept a non-default port');
  const targetHost = `${host.replaceAll('.', '-')}-s.atrust.cqu.edu.cn`;
  if (!isDnsHostname(targetHost)) throw new Error('generated aTrust hostname is invalid');
  url.protocol = 'https:';
  url.hostname = targetHost;
  if (url.hostname !== targetHost || !url.hostname.endsWith(ATRUST_SUFFIX)) {
    throw new Error('failed to generate expected aTrust hostname');
  }
  return url.toString();
}

export function toAtrustIpPortUrl(input: string): string {
  const url = parseHttpUrl(input);
  const rawAuthority = RAW_IPV4_PORT.exec(input);
  if (!rawAuthority) throw new Error('complete IPv4 and port required');
  const [, rawHost, rawPort] = rawAuthority;
  const octets = rawHost!.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) throw new Error('invalid IPv4');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  const targetHost = `${rawHost!.replaceAll('.', '-')}-${port}-p.atrust.cqu.edu.cn`;
  url.protocol = 'https:';
  url.hostname = targetHost;
  url.port = '';
  if (url.hostname !== targetHost || !url.hostname.endsWith(ATRUST_SUFFIX)) {
    throw new Error('failed to generate expected aTrust hostname');
  }
  return url.toString();
}

export function toYouthPublicUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (url.hostname.toLowerCase() !== 'youth.cqu.edu.cn') throw new Error('not a Youth League URL');
  const match = /^\/info\/(\d+)\/(\d+)\.htm$/.exec(url.pathname);
  if (!match) throw new Error('not a Youth League article');
  const [, wbtreeid, wbnewsid] = match;
  const preservedQuery = url.search
    .slice(1)
    .split('&')
    .filter((segment) => segment && !YOUTH_PARAMETERS.has(queryParameterName(segment)));
  const youthQuery = new URLSearchParams({
    urltype: 'news.NewsContentUrl',
    wbtreeid: wbtreeid!,
    wbnewsid: wbnewsid!,
  }).toString();
  url.pathname = '/content.jsp';
  url.search = [...preservedQuery, youthQuery].join('&');
  return url.toString();
}

export function assertCasServicePreserved(before: string, after: string): void {
  const beforeServices = parseHttpUrl(before).searchParams.getAll('service');
  const afterServices = parseHttpUrl(after).searchParams.getAll('service');
  if (
    beforeServices.length !== afterServices.length ||
    beforeServices.some((service, index) => service !== afterServices[index])
  ) {
    throw new Error('CAS service changed during rewrite');
  }
}

export function applyTransformer(transformer: Transformer, input: string): string {
  switch (transformer) {
    case 'atrust-domain':
      return toAtrustDomainUrl(input);
    case 'atrust-ip-port':
      return toAtrustIpPortUrl(input);
    case 'youth-public':
      return toYouthPublicUrl(input);
    default: {
      const exhaustive: never = transformer;
      throw new Error(`unknown transformer: ${String(exhaustive)}`);
    }
  }
}
