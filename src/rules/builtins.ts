import type { RuleDefinition } from './types';

export const BUILT_IN_RULES: readonly RuleDefinition[] = [
  {
    id: 'core-sso',
    dnrId: 1001,
    name: '统一身份认证',
    description: '通过 aTrust 打开统一身份认证入口',
    category: 'core',
    defaultEnabled: true,
    matcher: { kind: 'host', host: 'sso.cqu.edu.cn' },
    transformer: 'atrust-domain',
  },
  {
    id: 'addon-youth-public',
    dnrId: 2001,
    name: '团委公网链接',
    description: '将 /info 文章转换为 content.jsp 公网链接',
    category: 'addon',
    defaultEnabled: true,
    matcher: { kind: 'youth-article', host: 'youth.cqu.edu.cn' },
    transformer: 'youth-public',
  },
] as const;
