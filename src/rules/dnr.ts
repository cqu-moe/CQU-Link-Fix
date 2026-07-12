import type { Browser } from 'wxt/browser';
import { loadSettings } from '../storage/settings-repository';
import type { ExtensionSettings } from '../storage/settings-types';
import { getEnabledRules } from './registry';
import {
  recordDnrReconciliationStatus,
  type RuleValidationError,
} from './dnr-status';
import {
  compileMatcherRedirects,
  escapeDnrRegex,
  isYouthArticleMatcher,
  normalizeDnrHost,
} from './matcher';
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

export function getRulePriority(rule: RuleDefinition): number {
  if (rule.category === 'custom') return 30_000;
  if (isYouthArticleMatcher(rule.matcher)) return 20_000;
  return 10_000;
}

export function compareRulePrecedence(
  left: RuleDefinition,
  right: RuleDefinition,
): number {
  const rankDifference = getRulePriority(right) - getRulePriority(left);
  if (rankDifference !== 0) return rankDifference;

  const leftHandledByDnr = !isYouthArticleMatcher(left.matcher);
  const rightHandledByDnr = !isYouthArticleMatcher(right.matcher);
  if (leftHandledByDnr !== rightHandledByDnr) return leftHandledByDnr ? -1 : 1;
  return left.dnrId - right.dnrId || left.id.localeCompare(right.id);
}

function compileRedirects(
  rule: RuleDefinition,
  priority: number,
): Browser.declarativeNetRequest.Rule[] {
  return compileMatcherRedirects(rule.matcher, rule.dnrId, priority);
}

function compileAllows(excludedHosts: readonly string[]): Browser.declarativeNetRequest.Rule[] {
  const hosts = [...new Set(excludedHosts.map(normalizeDnrHost))].sort();
  return hosts.map((host, index) => ({
    id: ALLOW_ID_START + index,
    priority: 100_000,
    action: { type: 'allow' },
    condition: {
      regexFilter: `^https?://${escapeDnrRegex(host)}(?::\\d+)?(?:[/?]|$)`,
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

function assertUniqueRuleIds(rules: readonly { id: number }[]): void {
  const ids = new Set<number>();
  for (const rule of rules) {
    if (!Number.isInteger(rule.id) || rule.id < 1 || rule.id > MAX_RULE_ID) {
      throw new Error(`Invalid DNR rule ID: ${rule.id}`);
    }
    if (ids.has(rule.id)) throw new Error(`Duplicate DNR rule ID: ${rule.id}`);
    ids.add(rule.id);
  }
}

interface DynamicRuleCompilationPlan {
  globalRules: Browser.declarativeNetRequest.Rule[];
  priorities: Map<RuleDefinition, number>;
}

function planDynamicRuleCompilation(
  rules: readonly RuleDefinition[],
  excludedHosts: readonly string[],
): DynamicRuleCompilationPlan {
  const priorityCapacity = MAX_REDIRECT_PRIORITY - MIN_REDIRECT_PRIORITY + 1;
  if (rules.length > priorityCapacity) {
    throw new Error(`Redirect rule count exceeds unique priority capacity: ${rules.length}`);
  }
  const ordered = [...rules].sort(compareRulePrecedence);
  const priorities = new Map(
    ordered.map((rule, index) => [rule, MAX_REDIRECT_PRIORITY - index]),
  );
  const globalRules = [...compileAllows(excludedHosts), compileTicketAllow()];
  assertUniqueRuleIds(globalRules);
  return { globalRules, priorities };
}

export function compileDynamicRules(
  rules: readonly RuleDefinition[],
  excludedHosts: readonly string[],
): Browser.declarativeNetRequest.Rule[] {
  const { globalRules, priorities } = planDynamicRuleCompilation(rules, excludedHosts);
  const [ticketAllow] = globalRules.slice(-1);
  const compiled = [
    ...globalRules.slice(0, -1),
    ...rules.flatMap((rule) => compileRedirects(rule, priorities.get(rule)!)),
    ticketAllow!,
  ];
  assertUniqueRuleIds(compiled);
  return compiled;
}

function splitRequestUrl(input: string): { request: string; fragment: string } {
  const url = new URL(input);
  const fragment = url.hash;
  url.hash = '';
  return { request: url.toString(), fragment };
}

function stableStructure(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStructure).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) =>
      `${JSON.stringify(key)}:${stableStructure(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function matchingCompilerRule(
  rule: Browser.declarativeNetRequest.Rule,
  input: string,
): { matches: boolean; target: string | null } {
  const condition = rule.condition;
  if (!condition.regexFilter) return { matches: false, target: null };
  const { request, fragment } = splitRequestUrl(input);

  let match: RegExpExecArray | null;
  try {
    match = new RegExp(
      condition.regexFilter,
      condition.isUrlFilterCaseSensitive ? '' : 'i',
    ).exec(request);
  } catch {
    return { matches: false, target: null };
  }
  if (!match) return { matches: false, target: null };
  if (rule.action.type !== 'redirect') return { matches: true, target: null };
  const substitution = rule.action.redirect?.regexSubstitution;
  if (!substitution) return { matches: false, target: null };
  const substituted = substitution.replace(/\\([0-9])/g, (_capture, index: string) =>
    match?.[Number(index)] ?? '',
  );
  try {
    const target = new URL(substituted);
    if (!target.hash && fragment) target.hash = fragment;
    return { matches: true, target: target.toString() };
  } catch {
    return { matches: false, target: null };
  }
}

export function persistedDnrOwnsRewrite(
  previousRules: readonly Browser.declarativeNetRequest.Rule[],
  compiledRules: readonly Browser.declarativeNetRequest.Rule[],
  input: string,
  expectedRuleId: number,
  expectedTarget: string,
): boolean {
  const compiledShapes = new Set(compiledRules.map(stableStructure));
  const previousIds = new Set<number>();
  for (const rule of previousRules) {
    if (!compiledShapes.has(stableStructure(rule)) || previousIds.has(rule.id)) return false;
    previousIds.add(rule.id);
  }

  const matching: Array<{
    rule: Browser.declarativeNetRequest.Rule;
    priority: number;
    target: string | null;
  }> = [];
  for (const rule of previousRules) {
    const priority = rule.priority;
    if (typeof priority !== 'number') continue;
    const result = matchingCompilerRule(rule, input);
    if (result.matches) matching.push({ rule, priority, target: result.target });
  }
  if (matching.length === 0) return false;
  const highestPriority = Math.max(...matching.map(({ priority }) => priority));
  const winners = matching.filter(({ priority }) => priority === highestPriority);
  if (winners.length !== 1) return false;
  const winner = winners[0]!;
  try {
    return winner.rule.id === expectedRuleId &&
      winner.target !== null &&
      new URL(winner.target).toString() === new URL(expectedTarget).toString();
  } catch {
    return false;
  }
}

export interface DnrReconciliationEvidence {
  previousDynamicRules: Browser.declarativeNetRequest.Rule[];
  compiledDynamicRules: Browser.declarativeNetRequest.Rule[];
  validationErrors: RuleValidationError[];
}

async function regexValidationError(
  rule: Browser.declarativeNetRequest.Rule,
): Promise<string | null> {
  const regex = rule.condition.regexFilter;
  if (!regex) return null;
  const result = await browser.declarativeNetRequest.isRegexSupported({
    regex,
    isCaseSensitive: rule.condition.isUrlFilterCaseSensitive ?? false,
    requireCapturing: rule.action.redirect?.regexSubstitution !== undefined,
  });
  return result.isSupported
    ? null
    : `Unsupported regex in DNR rule ${rule.id}: ${result.reason ?? 'unknown'}`;
}

function compilationErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Unknown DNR compilation error';
}

export async function reconcileDynamicRules(
  settingsInput?: ExtensionSettings,
): Promise<DnrReconciliationEvidence> {
  const settings = settingsInput ?? await loadSettings();
  const enabledRules = getEnabledRules(settings);
  const { globalRules, priorities } = planDynamicRuleCompilation(
    enabledRules,
    settings.excludedHosts,
  );
  const validationErrors: RuleValidationError[] = [];
  const candidates: Array<{
    definition: RuleDefinition;
    redirects: Browser.declarativeNetRequest.Rule[];
  }> = [];
  for (const definition of enabledRules) {
    try {
      const redirects = compileRedirects(definition, priorities.get(definition)!);
      assertUniqueRuleIds(redirects);
      candidates.push({ definition, redirects });
    } catch (error) {
      validationErrors.push({
        ruleId: definition.id,
        message: compilationErrorMessage(error),
      });
    }
  }

  for (const rule of globalRules) {
    const error = await regexValidationError(rule);
    if (error) throw new Error(error);
  }

  const validRedirects: Browser.declarativeNetRequest.Rule[] = [];
  for (const candidate of candidates) {
    let candidateError: string | null = null;
    for (const redirect of candidate.redirects) {
      candidateError = await regexValidationError(redirect);
      if (candidateError) break;
    }
    if (candidateError) {
      validationErrors.push({
        ruleId: candidate.definition.id,
        message: candidateError,
      });
    } else {
      validRedirects.push(...candidate.redirects);
    }
  }

  const next = [
    ...globalRules.slice(0, -1),
    ...validRedirects,
    globalRules.at(-1)!,
  ];
  assertUniqueRuleIds(next);

  const current = await browser.declarativeNetRequest.getDynamicRules();
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.map((rule) => rule.id),
    addRules: next,
  });
  recordDnrReconciliationStatus({ errors: validationErrors });
  return {
    previousDynamicRules: structuredClone(current),
    compiledDynamicRules: structuredClone(next),
    validationErrors: structuredClone(validationErrors),
  };
}
