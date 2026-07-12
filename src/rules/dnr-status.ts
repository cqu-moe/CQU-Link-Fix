export interface RuleValidationError {
  ruleId: string;
  message: string;
}

export interface DnrReconciliationStatus {
  errors: RuleValidationError[];
}

let latestStatus: DnrReconciliationStatus = { errors: [] };

function cloneStatus(status: DnrReconciliationStatus): DnrReconciliationStatus {
  return structuredClone(status);
}

export function recordDnrReconciliationStatus(status: DnrReconciliationStatus): void {
  latestStatus = cloneStatus(status);
}

export function getDnrReconciliationStatus(): DnrReconciliationStatus {
  return cloneStatus(latestStatus);
}

export function parseDnrReconciliationStatus(value: unknown): DnrReconciliationStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 1 || !Array.isArray(candidate.errors)) return null;
  const errors: RuleValidationError[] = [];
  for (const valueError of candidate.errors) {
    if (!valueError || typeof valueError !== 'object' || Array.isArray(valueError)) return null;
    const error = valueError as Record<string, unknown>;
    if (
      Object.keys(error).length !== 2 ||
      typeof error.ruleId !== 'string' ||
      !error.ruleId.trim() ||
      typeof error.message !== 'string' ||
      !error.message.trim()
    ) return null;
    errors.push({ ruleId: error.ruleId, message: error.message });
  }
  return { errors };
}
