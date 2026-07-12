import type { Browser } from 'wxt/browser';
import { loadSettings, type ExtensionSettings } from '../storage/settings';
import { getEnabledRules } from './registry';
import type { RuleDefinition } from './types';

const ALLOW_ID_START = 80_000;
const TICKET_ALLOW_ID = 999_999_999;
const TICKET_ALLOW_PRIORITY = 2_000_000;
const MAX_RULE_ID = 2_147_483_647;
const MAX_REDIRECT_PRIORITY = 99_999;
const MIN_REDIRECT_PRIORITY = 1;
const MAIN_FRAME: NonNullable<Browser.declarativeNetRequest.RuleCondition['resourceTypes']> = [
  'main_frame',
];

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizeHost(host: string): string {
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
  const escapedHost = escapeRegex(host);
  return `(?:http://${escapedHost}(?::80)?|https://${escapedHost}(?::443)?)`;
}

function hostPortAuthority(host: string, port: number): string {
  const escapedHost = escapeRegex(host);
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

export function getRulePriority(rule: RuleDefinition): number {
  if (rule.category === 'custom') return 30_000;
  if (rule.matcher.kind === 'youth-article') return 20_000;
  return 10_000;
}

export function compareRulePrecedence(
  left: RuleDefinition,
  right: RuleDefinition,
): number {
  const rankDifference = getRulePriority(right) - getRulePriority(left);
  if (rankDifference !== 0) return rankDifference;

  const leftHandledByDnr = left.matcher.kind !== 'youth-article';
  const rightHandledByDnr = right.matcher.kind !== 'youth-article';
  if (leftHandledByDnr !== rightHandledByDnr) return leftHandledByDnr ? -1 : 1;
  return left.dnrId - right.dnrId || left.id.localeCompare(right.id);
}

function compileRedirects(
  rule: RuleDefinition,
  priority: number,
): Browser.declarativeNetRequest.Rule[] {
  const matcher = rule.matcher;

  if (matcher.kind === 'host') {
    const host = normalizeHost(matcher.host);
    return [
      redirectRule(
        rule.dnrId,
        priority,
        `^${defaultPortAuthority(host)}((?:[/?].*)?)$`,
        `https://${domainTarget(host)}\\1`,
      ),
    ];
  }

  if (matcher.kind === 'host-port') {
    const host = canonicalIpv4(matcher.host);
    if (!Number.isInteger(matcher.port) || matcher.port < 1 || matcher.port > 65_535) {
      throw new Error(`Host-port matcher has an invalid port: ${matcher.port}`);
    }
    const encoded = `${host.replaceAll('.', '-')}-${matcher.port}-p.atrust.cqu.edu.cn`;
    return [
      redirectRule(
        rule.dnrId,
        priority,
        `^${hostPortAuthority(host, matcher.port)}((?:[/?].*)?)$`,
        `https://${encoded}\\1`,
      ),
    ];
  }

  const host = normalizeHost(matcher.host);
  const authority = defaultPortAuthority(host);
  const target = `https://${host}/content.jsp`;
  return [
    redirectRule(
      rule.dnrId,
      priority,
      `^${authority}/info/(\\d+)/(\\d+)\\.htm(?:\\?)?(#.*)?$`,
      `${target}?urltype=news.NewsContentUrl&wbtreeid=\\1&wbnewsid=\\2\\3`,
    ),
  ];
}

function compileAllows(excludedHosts: readonly string[]): Browser.declarativeNetRequest.Rule[] {
  const hosts = [...new Set(excludedHosts.map(normalizeHost))].sort();
  return hosts.map((host, index) => ({
    id: ALLOW_ID_START + index,
    priority: 100_000,
    action: { type: 'allow' },
    condition: {
      regexFilter: `^https?://${escapeRegex(host)}(?::\\d+)?(?:[/?]|$)`,
      isUrlFilterCaseSensitive: false,
      resourceTypes: MAIN_FRAME,
    },
  }));
}

function compileTicketAllow(): Browser.declarativeNetRequest.Rule {
  return {
    id: TICKET_ALLOW_ID,
    priority: TICKET_ALLOW_PRIORITY,
    action: { type: 'allow' },
    condition: {
      regexFilter:
        '^https?://[^?#]+\\?(?:[^#&]*&)*(?:t|%74)(?:i|%69)(?:c|%63)(?:k|%6[bB])(?:e|%65)(?:t|%74)(?:=[^#&]*)?(?:&[^#&]*)*(?:#.*)?$',
      isUrlFilterCaseSensitive: true,
      resourceTypes: MAIN_FRAME,
    },
  };
}

function assertUniqueRuleIds(rules: readonly Browser.declarativeNetRequest.Rule[]): void {
  const ids = new Set<number>();
  for (const rule of rules) {
    if (!Number.isInteger(rule.id) || rule.id < 1 || rule.id > MAX_RULE_ID) {
      throw new Error(`Invalid DNR rule ID: ${rule.id}`);
    }
    if (ids.has(rule.id)) throw new Error(`Duplicate DNR rule ID: ${rule.id}`);
    ids.add(rule.id);
  }
}

export function compileDynamicRules(
  rules: readonly RuleDefinition[],
  excludedHosts: readonly string[],
): Browser.declarativeNetRequest.Rule[] {
  const priorityCapacity = MAX_REDIRECT_PRIORITY - MIN_REDIRECT_PRIORITY + 1;
  if (rules.length > priorityCapacity) {
    throw new Error(`Redirect rule count exceeds unique priority capacity: ${rules.length}`);
  }
  const ordered = [...rules].sort(compareRulePrecedence);
  const priorities = new Map(
    ordered.map((rule, index) => [rule, MAX_REDIRECT_PRIORITY - index]),
  );
  const compiled = [
    ...compileAllows(excludedHosts),
    ...rules.flatMap((rule) => compileRedirects(rule, priorities.get(rule)!)),
    compileTicketAllow(),
  ];
  assertUniqueRuleIds(compiled);
  return compiled;
}

function requestUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';
  return url.toString();
}

function matchingRegexRedirectTarget(
  rule: Browser.declarativeNetRequest.Rule,
  input: string,
): string | null {
  const condition = rule.condition;
  const supportedConditionKeys = new Set([
    'isUrlFilterCaseSensitive',
    'regexFilter',
    'resourceTypes',
  ]);
  if (Object.keys(condition).some((key) => !supportedConditionKeys.has(key))) return null;
  if (condition.resourceTypes && !condition.resourceTypes.includes('main_frame')) return null;
  if (!condition.regexFilter || rule.action.type !== 'redirect') return null;
  const substitution = rule.action.redirect?.regexSubstitution;
  if (!substitution) return null;

  let match: RegExpExecArray | null;
  try {
    match = new RegExp(
      condition.regexFilter,
      condition.isUrlFilterCaseSensitive ? '' : 'i',
    ).exec(requestUrl(input));
  } catch {
    return null;
  }
  if (!match) return null;
  return substitution.replace(/\\([0-9])/g, (_capture, index: string) =>
    match?.[Number(index)] ?? '',
  );
}

export function persistedDnrOwnsRewrite(
  rules: readonly Browser.declarativeNetRequest.Rule[],
  input: string,
  expectedRuleId: number,
  expectedTarget: string,
): boolean {
  const matching: Array<{
    rule: Browser.declarativeNetRequest.Rule;
    priority: number;
    target: string | null;
  }> = [];
  for (const rule of rules) {
    const priority = rule.priority;
    if (typeof priority !== 'number') continue;
    const target = matchingRegexRedirectTarget(rule, input);
    if (target) {
      matching.push({ rule, priority, target });
      continue;
    }

    const condition = rule.condition;
    if (!condition.regexFilter || rule.action.type === 'redirect') continue;
    try {
      const regex = new RegExp(
        condition.regexFilter,
        condition.isUrlFilterCaseSensitive ? '' : 'i',
      );
      if (regex.test(requestUrl(input))) matching.push({ rule, priority, target: null });
    } catch {
      // Unknown stale rules are not trusted as ownership evidence.
    }
  }
  if (matching.length === 0) return false;
  const highestPriority = Math.max(...matching.map(({ priority }) => priority));
  const winners = matching.filter(({ priority }) => priority === highestPriority);
  if (winners.length !== 1) return false;
  const winner = winners[0]!;
  try {
    return winner.rule.id === expectedRuleId &&
      winner.target !== null &&
      requestUrl(winner.target) === requestUrl(expectedTarget);
  } catch {
    return false;
  }
}

export async function reconcileDynamicRules(
  settingsInput?: ExtensionSettings,
): Promise<{ previousDynamicRules: Browser.declarativeNetRequest.Rule[] }> {
  const settings = settingsInput ?? await loadSettings();
  const next = compileDynamicRules(getEnabledRules(settings), settings.excludedHosts);

  for (const rule of next) {
    const regex = rule.condition.regexFilter;
    if (!regex) continue;
    const result = await browser.declarativeNetRequest.isRegexSupported({
      regex,
      isCaseSensitive: rule.condition.isUrlFilterCaseSensitive ?? false,
      requireCapturing: rule.action.redirect?.regexSubstitution !== undefined,
    });
    if (!result.isSupported) {
      throw new Error(`Unsupported regex in DNR rule ${rule.id}: ${result.reason ?? 'unknown'}`);
    }
  }

  const current = await browser.declarativeNetRequest.getDynamicRules();
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.map((rule) => rule.id),
    addRules: next,
  });
  return { previousDynamicRules: structuredClone(current) };
}
