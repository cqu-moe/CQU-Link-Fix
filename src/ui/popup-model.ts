import {
  parseSafeHttpUrl,
  sameRequestUrl,
  type RewriteRecord,
} from '../rewrite-record';

export interface PopupModel {
  runtimeState: PopupRuntimeState;
  runtimeLabel: string;
  status: string;
  originalHost: string;
  targetHost: string;
  canBypass: boolean;
  canExclude: boolean;
  ruleId: string | null;
  error: string | null;
}

export type PopupRuntimeState = 'enabled' | 'disabled' | 'unavailable';

const RUNTIME_LABELS = {
  enabled: '扩展运行中',
  disabled: '扩展已停用',
  unavailable: '扩展后台不可用',
} satisfies Record<PopupRuntimeState, string>;

function runtimeFields(runtimeState: PopupRuntimeState): Pick<
  PopupModel,
  'runtimeState' | 'runtimeLabel'
> {
  return { runtimeState, runtimeLabel: RUNTIME_LABELS[runtimeState] };
}

const UNSUPPORTED_MODEL: Omit<PopupModel, 'runtimeState' | 'runtimeLabel'> = {
  status: '此页面不支持链接改写',
  originalHost: '—',
  targetHost: '—',
  canBypass: false,
  canExclude: false,
  ruleId: null,
  error: null,
};

export function buildPopupModel(
  tabUrl: string | null | undefined,
  record: RewriteRecord | null | undefined,
  runtimeState: PopupRuntimeState = 'enabled',
): PopupModel {
  const current = parseSafeHttpUrl(tabUrl);
  if (!current) return { ...runtimeFields(runtimeState), ...UNSUPPORTED_MODEL };

  const unchanged: PopupModel = {
    ...runtimeFields(runtimeState),
    status: '当前页面未改写',
    originalHost: current.hostname,
    targetHost: current.hostname,
    canBypass: false,
    canExclude: true,
    ruleId: null,
    error: null,
  };
  if (!record) return unchanged;

  const original = parseSafeHttpUrl(record.originalUrl);
  const target = parseSafeHttpUrl(record.targetUrl);
  if (
    !original ||
    !target ||
    !sameRequestUrl(tabUrl ?? '', record.targetUrl)
  ) {
    return unchanged;
  }

  const error = typeof record.error === 'string' && record.error.length > 0
    ? record.error
    : null;
  return {
    ...runtimeFields(runtimeState),
    status: record.ruleId === 'addon-youth-public'
      ? error ? '团委公网页面加载失败' : '已转换为团委公网链接'
      : error ? 'aTrust 页面加载失败' : '已通过 aTrust 打开',
    originalHost: original.hostname,
    targetHost: target.hostname,
    canBypass: true,
    canExclude: true,
    ruleId: record.ruleId,
    error,
  };
}
