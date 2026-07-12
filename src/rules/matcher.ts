import type { Browser } from 'wxt/browser';
import { customPermissionOriginsForHost } from '../custom-permission-lease';
import { normalizeCustomCquHost } from './custom-rule-policy';
import type { CustomRule, RuleDefinition, RuleMatcher } from './types';

const MAIN_FRAME: NonNullable<Browser.declarativeNetRequest.RuleCondition['resourceTypes']> = [
  'main_frame',
];
const EXPLICIT_PORT = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*:(\d+)(?=[/?#]|$)/i;

function assertNever(value: never): never {
  throw new Error(`Unsupported matcher kind: ${JSON.stringify(value)}`);
}

export function escapeDnrRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeDnrHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 253 ||
    !normalized.split('.').every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label),
    )
  ) {
    throw new Error(`Invalid DNR host: ${host}`);
  }
  return normalized;
}

function canonicalIpv4(host: string): string {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host)) {
    throw new Error(`Host-port matcher requires a complete canonical IPv4: ${host}`);
  }
  if (host.split('.').some((octet) => Number(octet) > 255)) {
    throw new Error(`Host-port matcher requires a complete canonical IPv4: ${host}`);
  }
  return host;
}

function domainTarget(host: string): string {
  return `${host.replaceAll('.', '-')}-s.atrust.cqu.edu.cn`;
}

function defaultPortAuthority(host: string): string {
  const escapedHost = escapeDnrRegex(host);
  return `(?:http://${escapedHost}(?::80)?|https://${escapedHost}(?::443)?)`;
}

function hostPortAuthority(host: string, port: number): string {
  const escapedHost = escapeDnrRegex(host);
  if (port === 80) return `(?:http://${escapedHost}|https://${escapedHost}:80)`;
  if (port === 443) return `(?:https://${escapedHost}|http://${escapedHost}:443)`;
  return `https?://${escapedHost}:${port}`;
}

function redirectRule(
  id: number,
  priority: number,
  regexFilter: string,
  regexSubstitution: string,
): Browser.declarativeNetRequest.Rule {
  return {
    id,
    priority,
    action: { type: 'redirect', redirect: { regexSubstitution } },
    condition: {
      regexFilter,
      isUrlFilterCaseSensitive: false,
      resourceTypes: MAIN_FRAME,
    },
  };
}

export function isYouthArticleMatcher(
  matcher: RuleMatcher,
): matcher is Extract<RuleMatcher, { kind: 'youth-article' }> {
  return matcher.kind === 'youth-article';
}

export function exactHostMatcherHost(matcher: RuleMatcher): string | null {
  switch (matcher.kind) {
    case 'host': return matcher.host.toLowerCase();
    case 'host-port':
    case 'youth-article': return null;
    default: return assertNever(matcher);
  }
}

export function matcherSourceHosts(matcher: RuleMatcher): string[] {
  switch (matcher.kind) {
    case 'host':
    case 'host-port':
    case 'youth-article': return [matcher.host.toLowerCase()];
    default: return assertNever(matcher);
  }
}

export function matcherRangeLabel(matcher: RuleMatcher): string {
  switch (matcher.kind) {
    case 'host':
    case 'youth-article': return matcher.host;
    case 'host-port': return `${matcher.host}:${matcher.port}`;
    default: return assertNever(matcher);
  }
}

export function matchesRuleMatcher(
  input: string,
  url: URL,
  matcher: RuleMatcher,
): boolean {
  if (url.hostname.toLowerCase() !== matcher.host.toLowerCase()) return false;
  switch (matcher.kind) {
    case 'host': return !url.port;
    case 'host-port': {
      const explicitPort = EXPLICIT_PORT.exec(input)?.[1];
      return explicitPort !== undefined && Number(explicitPort) === matcher.port;
    }
    case 'youth-article':
      return !url.port && /^\/info\/\d+\/\d+\.htm$/.test(url.pathname);
    default: return assertNever(matcher);
  }
}

export function matcherDnrHandlesUrl(matcher: RuleMatcher, url: URL): boolean {
  switch (matcher.kind) {
    case 'host':
    case 'host-port': return true;
    case 'youth-article': return !url.search;
    default: return assertNever(matcher);
  }
}

export function compileMatcherRedirects(
  matcher: RuleMatcher,
  dnrId: number,
  priority: number,
): Browser.declarativeNetRequest.Rule[] {
  switch (matcher.kind) {
    case 'host': {
      const host = normalizeDnrHost(matcher.host);
      return [redirectRule(
        dnrId,
        priority,
        `^${defaultPortAuthority(host)}((?:[/?].*)?)$`,
        `https://${domainTarget(host)}\\1`,
      )];
    }
    case 'host-port': {
      const host = canonicalIpv4(matcher.host);
      if (!Number.isInteger(matcher.port) || matcher.port < 1 || matcher.port > 65_535) {
        throw new Error(`Host-port matcher has an invalid port: ${matcher.port}`);
      }
      const encoded = `${host.replaceAll('.', '-')}-${matcher.port}-p.atrust.cqu.edu.cn`;
      return [redirectRule(
        dnrId,
        priority,
        `^${hostPortAuthority(host, matcher.port)}((?:[/?].*)?)$`,
        `https://${encoded}\\1`,
      )];
    }
    case 'youth-article': {
      const host = normalizeDnrHost(matcher.host);
      return [redirectRule(
        dnrId,
        priority,
        `^${defaultPortAuthority(host)}/info/(\\d+)/(\\d+)\\.htm(?:\\?)?(#.*)?$`,
        `https://${host}/content.jsp?urltype=news.NewsContentUrl&wbtreeid=\\1&wbnewsid=\\2\\3`,
      )];
    }
    default: return assertNever(matcher);
  }
}

export function permissionOriginsForRule(rule: RuleDefinition): string[] {
  switch (rule.matcher.kind) {
    case 'host-port': return [];
    case 'host':
      return rule.transformer === 'atrust-domain'
        ? [...customPermissionOriginsForHost(rule.matcher.host)]
        : [`*://${rule.matcher.host}/*`];
    case 'youth-article': return [`*://${rule.matcher.host}/*`];
    default: return assertNever(rule.matcher);
  }
}

export function parsePersistedCustomMatcher(
  value: unknown,
  transformer: unknown,
): CustomRule['matcher'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Custom matcher kind is invalid');
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind !== 'host' ||
    Object.keys(candidate).sort().join(',') !== 'host,kind' ||
    transformer !== 'atrust-domain'
  ) throw new Error('Custom matcher kind is invalid');
  try {
    return { kind: 'host', host: normalizeCustomCquHost(candidate.host) };
  } catch {
    throw new Error('Custom host rule is invalid');
  }
}
