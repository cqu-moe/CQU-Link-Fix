import type { ExtensionSettings } from '../storage/settings';
import { BUILT_IN_RULES } from './builtins';
import {
  applyTransformer,
  assertCasServicePreserved,
  hasTopLevelCasTicket,
} from './transform';
import type { RewriteDecision, RuleDefinition } from './types';
import { matchesRuleMatcher } from './matcher';

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
  const rule = rules.find((candidate) => matchesRuleMatcher(input, url, candidate.matcher));
  if (!rule) return null;

  const targetUrl = applyTransformer(rule.transformer, input);
  if (url.hostname.toLowerCase() === 'sso.cqu.edu.cn') {
    assertCasServicePreserved(input, targetUrl);
  }
  return { ruleId: rule.id, originalUrl: input, targetUrl };
}
