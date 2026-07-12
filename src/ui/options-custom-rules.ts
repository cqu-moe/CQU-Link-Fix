import {
  CUSTOM_PERMISSION_LEASE_RENEW_INTERVAL_MS,
  type CustomPermissionLeaseHandle,
} from '../custom-permission-lease';
import type { CustomRule } from '../rules/types';
import {
  customRulePermissions,
  parseCustomRule,
  type ExactOriginPermission,
} from './custom-rule';

interface OriginPermission {
  origins: string[];
}

export interface CustomRulePermissionDependencies {
  containsPermission: (permission: OriginPermission) => Promise<boolean>;
  requestPermission: (permission: ExactOriginPermission) => Promise<boolean>;
  acquirePermissionLease: (
    permission: ExactOriginPermission,
  ) => Promise<CustomPermissionLeaseHandle | null>;
  renewPermissionLease: (
    nonce: string,
    permission: ExactOriginPermission,
  ) => Promise<boolean>;
  releasePermissionLease: (
    nonce: string,
    cleanupOrigins?: readonly string[],
  ) => Promise<boolean>;
}

export type CustomRuleCommitOutcome = 'success' | 'conflict' | 'failure';

export type BeginCustomRuleAddition =
  | { started: false; error: string }
  | {
      started: true;
      rule: CustomRule;
      completion: Promise<{ clearInput: boolean; error: string | null }>;
    };

interface CustomPermissionLeaseHeartbeat {
  stop: () => Promise<boolean>;
}

function startCustomPermissionLeaseHeartbeat(
  nonce: string,
  permission: ExactOriginPermission,
  renew: CustomRulePermissionDependencies['renewPermissionLease'],
): CustomPermissionLeaseHeartbeat {
  let stopped = false;
  let ownershipCertain = true;
  let renewal: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stopTimer = (): void => {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const runRenewal = (): Promise<void> => {
    if (stopped || renewal !== null) return Promise.resolve();
    renewal = (async () => {
      try {
        if (!await renew(nonce, permission)) {
          ownershipCertain = false;
          stopTimer();
        }
      } catch {
        ownershipCertain = false;
        stopTimer();
      }
    })().finally(() => {
      renewal = null;
    });
    return renewal;
  };

  timer = setInterval(() => {
    void runRenewal();
  }, CUSTOM_PERMISSION_LEASE_RENEW_INTERVAL_MS);

  return {
    stop: async () => {
      stopTimer();
      if (renewal) await renewal;
      return ownershipCertain;
    },
  };
}

export function beginCustomRuleAddition(
  input: string,
  dnrId: number,
  existingCustomRules: readonly CustomRule[],
  dependencies: CustomRulePermissionDependencies,
  commitRule: (rule: CustomRule) => Promise<CustomRuleCommitOutcome>,
): BeginCustomRuleAddition {
  let rule: CustomRule;
  let permission: ExactOriginPermission;
  try {
    rule = parseCustomRule(input, dnrId, existingCustomRules);
    permission = customRulePermissions(rule);
  } catch (error) {
    return {
      started: false,
      error: error instanceof Error ? error.message : '自定义规则无效',
    };
  }

  // These operations intentionally start before the first async boundary so
  // Chromium sees the permission request in the original submit gesture.
  const containmentOperation = Promise.allSettled(permission.origins.map((origin) => {
    try {
      return dependencies.containsPermission({ origins: [origin] });
    } catch (error) {
      return Promise.reject(error);
    }
  }));
  let leaseOperation: Promise<CustomPermissionLeaseHandle | null>;
  try {
    leaseOperation = dependencies.acquirePermissionLease(permission);
  } catch {
    leaseOperation = Promise.resolve(null);
  }
  let requestOperation: Promise<boolean>;
  try {
    requestOperation = dependencies.requestPermission(permission);
  } catch {
    requestOperation = Promise.resolve(false);
  }

  const completion = (async (): Promise<{ clearInput: boolean; error: string | null }> => {
    let heartbeat: CustomPermissionLeaseHeartbeat | null = null;
    try {
      let lease: CustomPermissionLeaseHandle | null = null;
      try { lease = await leaseOperation; } catch { lease = null; }
      if (!lease) {
        try { await requestOperation; } catch { /* The grant state is uncertain; retain it. */ }
        return {
          clearInput: false,
          error: '无法建立权限协调租约；规则未保存，访问权限已保留。',
        };
      }
      heartbeat = startCustomPermissionLeaseHeartbeat(
        lease.nonce,
        permission,
        dependencies.renewPermissionLease,
      );

      let granted = false;
      try { granted = await requestOperation; } catch { granted = false; }
      if (!granted) {
        await heartbeat.stop();
        try { await dependencies.releasePermissionLease(lease.nonce); } catch { /* TTL cleanup remains. */ }
        return { clearInput: false, error: '未授予该域名的访问权限，规则未保存。' };
      }

      const containment = await containmentOperation;
      const canProveOwnership = containment.every((result) => result.status === 'fulfilled');
      const newlyAcquiredOrigins = canProveOwnership
        ? permission.origins.filter((_, index) =>
          containment[index]!.status === 'fulfilled' && !containment[index]!.value,
        )
        : null;

      let grantStillPresent = false;
      try {
        grantStillPresent = await dependencies.containsPermission(permission);
      } catch {
        grantStillPresent = false;
      }
      if (!grantStillPresent) {
        await heartbeat.stop();
        try { await dependencies.releasePermissionLease(lease.nonce); } catch { /* TTL cleanup remains. */ }
        return { clearInput: false, error: '权限状态已变化，规则未保存；请重新添加。' };
      }

      const outcome = await commitRule(rule);
      if (outcome === 'success') {
        await heartbeat.stop();
        try { await dependencies.releasePermissionLease(lease.nonce); } catch { /* TTL cleanup remains. */ }
        return { clearInput: true, error: null };
      }

      const leaseOwnershipCertain = await heartbeat.stop();
      if (newlyAcquiredOrigins === null || !leaseOwnershipCertain) {
        try { await dependencies.releasePermissionLease(lease.nonce); } catch { /* TTL cleanup remains. */ }
        return {
          clearInput: false,
          error: '规则未保存，且无法安全确认权限归属；已保留访问权限。',
        };
      }
      let released = false;
      try {
        released = await dependencies.releasePermissionLease(lease.nonce, newlyAcquiredOrigins);
      } catch {
        released = false;
      }
      if (!released) {
        return {
          clearInput: false,
          error: '规则未保存，且后台无法完成权限清理；已保留访问权限。',
        };
      }
      return {
        clearInput: false,
        error: outcome === 'conflict'
          ? '设置已更新，请重新填写并添加该规则。'
          : '规则未保存。',
      };
    } catch {
      return {
        clearInput: false,
        error: '权限处理未完成；规则未保存，访问权限已保留。',
      };
    } finally {
      if (heartbeat) await heartbeat.stop();
    }
  })();

  return { started: true, rule, completion };
}
