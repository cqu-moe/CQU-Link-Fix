import type { Browser } from 'wxt/browser';
import { loadSettings } from '../storage/settings';
import { getEnabledRules } from './registry';
import type { RuleDefinition } from './types';

const ALLOW_ID_START = 80_000;
const YOUTH_QUERY_ID_OFFSET = 40_000;
const MAX_RULE_ID = 2_147_483_647;
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

function domainTarget(host: string): string {
  return `${host.replaceAll('.', '-')}-s.atrust.cqu.edu.cn`;
}

function defaultPortAuthority(host: string): string {
  const escapedHost = escapeRegex(host);
  return `(?:http://${escapedHost}(?::80)?|https://${escapedHost}(?::443)?)`;
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

function compileRedirects(rule: RuleDefinition): Browser.declarativeNetRequest.Rule[] {
  const matcher = rule.matcher;
  const host = normalizeHost(matcher.host);
  const priority = rule.category === 'custom' ? 30_000 : 10_000;

  if (matcher.kind === 'host') {
    return [
      redirectRule(
        rule.dnrId,
        priority,
        `^${defaultPortAuthority(host)}((?:[/?#].*)?)$`,
        `https://${domainTarget(host)}\\1`,
      ),
    ];
  }

  if (matcher.kind === 'host-port') {
    const encoded = `${host.replaceAll('.', '-')}-${matcher.port}-p.atrust.cqu.edu.cn`;
    return [
      redirectRule(
        rule.dnrId,
        priority,
        `^https?://${escapeRegex(host)}:${matcher.port}((?:[/?#].*)?)$`,
        `https://${encoded}\\1`,
      ),
    ];
  }

  const authority = defaultPortAuthority(host);
  const target = `https://${host}/content.jsp`;
  const queryRuleId = rule.dnrId + YOUTH_QUERY_ID_OFFSET;
  if (queryRuleId > MAX_RULE_ID) throw new Error(`DNR rule ID is too large: ${rule.dnrId}`);
  return [
    redirectRule(
      rule.dnrId,
      20_000,
      `^${authority}/info/(\\d+)/(\\d+)\\.htm(#.*)?$`,
      `${target}?urltype=news.NewsContentUrl&wbtreeid=\\1&wbnewsid=\\2\\3`,
    ),
    redirectRule(
      queryRuleId,
      20_000,
      `^${authority}/info/(\\d+)/(\\d+)\\.htm\\?([^#]+)(#.*)?$`,
      `${target}?\\3&urltype=news.NewsContentUrl&wbtreeid=\\1&wbnewsid=\\2\\4`,
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
      regexFilter: `^https?://${escapeRegex(host)}(?::\\d+)?(?:[/?#]|$)`,
      isUrlFilterCaseSensitive: false,
      resourceTypes: MAIN_FRAME,
    },
  }));
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
  const compiled = [
    ...compileAllows(excludedHosts),
    ...rules.flatMap((rule) => compileRedirects(rule)),
  ];
  assertUniqueRuleIds(compiled);
  return compiled;
}

export async function reconcileDynamicRules(): Promise<void> {
  const settings = await loadSettings();
  const next = compileDynamicRules(getEnabledRules(settings), settings.excludedHosts);

  for (const rule of next) {
    const regex = rule.condition.regexFilter;
    if (!regex) continue;
    const result = await browser.declarativeNetRequest.isRegexSupported({
      regex,
      isCaseSensitive: false,
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
}
