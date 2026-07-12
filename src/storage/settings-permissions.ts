import { parseAllCquModeResponse } from './settings-codec';

export const CQU_OPTIONAL_ORIGINS = {
  origins: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'],
};

export async function setAllCquMode(enabled: boolean): Promise<boolean> {
  if (enabled) {
    let containmentOperation: Promise<boolean>;
    try {
      containmentOperation = browser.permissions.contains(CQU_OPTIONAL_ORIGINS);
    } catch (error) {
      containmentOperation = Promise.reject(error);
    }
    let requestOperation: Promise<boolean>;
    try {
      requestOperation = browser.permissions.request(CQU_OPTIONAL_ORIGINS);
    } catch (error) {
      requestOperation = Promise.reject(error);
    }
    const [containment, request] = await Promise.allSettled([
      containmentOperation,
      requestOperation,
    ]);
    if (
      containment.status === 'rejected' ||
      request.status === 'rejected' ||
      !request.value
    ) {
      await reconcileAllCquModeViaBackground(false);
      return false;
    }
    return reconcileAllCquModeViaBackground(true);
  }
  return reconcileAllCquModeViaBackground(false);
}

async function reconcileAllCquModeViaBackground(requested: boolean): Promise<boolean> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'reconcile-all-cqu-mode',
      requested,
    }) as unknown;
    return parseAllCquModeResponse(response, requested);
  } catch {
    return false;
  }
}
