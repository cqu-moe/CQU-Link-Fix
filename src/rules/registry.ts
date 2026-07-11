import type { ExtensionSettings } from '../storage/settings';
import { BUILT_IN_RULES } from './builtins';
import {
  applyTransformer,
  assertCasServicePreserved,
  hasTopLevelCasTicket,
} from './transform';
import type { RewriteDecision, RuleDefinition } from './types';

const EXPLICIT_PORT = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*:(\d+)(?=[/?#]|$)/i;

export function getEnabledRules(settings: ExtensionSettings): RuleDefinition[] {
  if (!settings.enabled) return [];
  const disabled = new Set(settings.disabledRuleIds);
  const enabledRules = [
    ...BUILT_IN_RULES.filter((rule) => rule.defaultEnabled && !disabled.has(rule.id)),
    ...settings.customRules.filter((rule) => !disabled.has(rule.id)),
  ];
  return structuredClone(enabledRules);
}

export function decideRegisteredRewrite(
  input: string,
  rules: readonly RuleDefinition[],
): RewriteDecision | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    hasTopLevelCasTicket(url)
  ) {
    return null;
  }
  const rule = rules.find((candidate) => matchesRule(input, url, candidate));
  if (!rule) return null;

  const targetUrl = applyTransformer(rule.transformer, input);
  if (url.hostname.toLowerCase() === 'sso.cqu.edu.cn') {
    assertCasServicePreserved(input, targetUrl);
  }
  return { ruleId: rule.id, originalUrl: input, targetUrl };
}

function matchesRule(input: string, url: URL, rule: RuleDefinition): boolean {
  const matcher = rule.matcher;
  const hostname = url.hostname.toLowerCase();
  const expectedHost = matcher.host.toLowerCase();
  if (hostname !== expectedHost) return false;

  if (matcher.kind === 'host') return !url.port;
  if (matcher.kind === 'host-port') {
    const explicitPort = EXPLICIT_PORT.exec(input)?.[1];
    return explicitPort !== undefined && Number(explicitPort) === matcher.port;
  }
  return !url.port && /^\/info\/\d+\/\d+\.htm$/.test(url.pathname);
}
