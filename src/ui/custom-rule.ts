import { BUILT_IN_RULES } from '../rules/builtins';
import type { CustomRule } from '../rules/types';
import { normalizeCustomCquHost } from '../storage/settings';

export const CUSTOM_DNR_ID_MIN = 10_001;
export const CUSTOM_DNR_ID_MAX = 79_999;

export interface ExactOriginPermission {
  origins: string[];
}

function sourceHosts(rules: readonly CustomRule[]): Set<string> {
  return new Set(rules.flatMap((rule) =>
    rule.matcher.kind === 'host' ? [rule.matcher.host.toLowerCase()] : [],
  ));
}

export function parseCustomRule(
  input: string,
  dnrId: number,
  existingCustomRules: readonly CustomRule[] = [],
): CustomRule {
  if (
    !Number.isSafeInteger(dnrId) ||
    dnrId < CUSTOM_DNR_ID_MIN ||
    dnrId > CUSTOM_DNR_ID_MAX ||
    BUILT_IN_RULES.some((rule) => rule.dnrId === dnrId) ||
    existingCustomRules.some((rule) => rule.dnrId === dnrId)
  ) {
    throw new Error('自定义规则 DNR ID 不可用');
  }

  const host = normalizeCustomCquHost(input);
  if (BUILT_IN_RULES.some((rule) => rule.matcher.host.toLowerCase() === host)) {
    throw new Error('该域名已有内置规则');
  }
  if (sourceHosts(existingCustomRules).has(host)) {
    throw new Error('该自定义域名已存在');
  }

  return {
    id: crypto.randomUUID(),
    dnrId,
    name: host,
    description: `通过 aTrust 打开 ${host}`,
    category: 'custom',
    defaultEnabled: true,
    matcher: { kind: 'host', host },
    transformer: 'atrust-domain',
  };
}

export function selectNextCustomDnrId(usedIds: Iterable<number>): number | null {
  const used = new Set(usedIds);
  for (const rule of BUILT_IN_RULES) used.add(rule.dnrId);
  for (let id = CUSTOM_DNR_ID_MIN; id <= CUSTOM_DNR_ID_MAX; id += 1) {
    if (!used.has(id)) return id;
  }
  return null;
}

export function customRulePermissions(rule: CustomRule): ExactOriginPermission {
  if (rule.matcher.kind !== 'host') throw new Error('自定义权限仅支持域名规则');
  const host = normalizeCustomCquHost(rule.matcher.host);
  const targetHost = `${host.replaceAll('.', '-')}-s.atrust.cqu.edu.cn`;
  return {
    origins: [`*://${host}/*`, `https://${targetHost}/*`],
  };
}
