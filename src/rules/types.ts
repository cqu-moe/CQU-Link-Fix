export type RuleCategory = 'core' | 'important' | 'ip' | 'addon' | 'custom';
export type Transformer = 'atrust-domain' | 'atrust-ip-port' | 'youth-public';

export type RuleMatcher =
  | { kind: 'host'; host: string }
  | { kind: 'host-port'; host: string; port: number }
  | { kind: 'youth-article'; host: 'youth.cqu.edu.cn' };

export interface RuleDefinition {
  id: string;
  dnrId: number;
  name: string;
  description: string;
  category: RuleCategory;
  defaultEnabled: boolean;
  matcher: RuleMatcher;
  transformer: Transformer;
}

export interface CustomRule extends RuleDefinition {
  category: 'custom';
}

export interface RewriteDecision {
  ruleId: string;
  originalUrl: string;
  targetUrl: string;
}
