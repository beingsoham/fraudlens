/** Shared pagination defaults and limits for list endpoints. */

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const SORT_DIRECTION = {
  ASC: 'asc',
  DESC: 'desc',
};
export const SORT_DIRECTIONS = Object.values(SORT_DIRECTION);

/** Sortable columns, whitelisted per resource so no client input reaches SQL. */
export const TRANSACTION_SORT_FIELDS = ['occurredAt', 'amount', 'riskScore', 'createdAt', 'status'];
export const ALERT_SORT_FIELDS = ['createdAt', 'updatedAt', 'severity', 'riskScore', 'status'];
export const USER_SORT_FIELDS = ['createdAt', 'name', 'email', 'role'];
export const AUDIT_SORT_FIELDS = ['createdAt', 'action', 'entityType'];
