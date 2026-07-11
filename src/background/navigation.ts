import { type ExtensionSettings } from '../storage/settings';
import { isAtrustUrl, isCquDomain, toAtrustDomainUrl } from '../rules/transform';

export interface NavigationInput {
  tabId: number;
  frameId: number;
  url: string;
}

function isExcludedHost(host: string, excludedHosts: readonly string[]): boolean {
  return excludedHosts.some((excluded) => excluded.trim().toLowerCase() === host);
}

export function decideAllCquRewrite(
  details: NavigationInput,
  settings: ExtensionSettings,
): string | null {
  if (
    !settings.enabled ||
    !settings.enableAllCquDomains ||
    details.frameId !== 0 ||
    details.tabId < 0
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return null;
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (isExcludedHost(host, settings.excludedHosts)) return null;

  try {
    if (isAtrustUrl(details.url) || !isCquDomain(details.url)) return null;
    return toAtrustDomainUrl(details.url);
  } catch {
    return null;
  }
}
