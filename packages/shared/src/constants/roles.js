/**
 * Roles and the permissions they grant.
 *
 * Authorization is always enforced on the server. The frontend uses the same
 * table only to decide what to render; it is never the security boundary.
 */

export const USER_ROLE = {
  ADMIN: 'ADMIN',
  ANALYST: 'ANALYST',
  INVESTIGATOR: 'INVESTIGATOR',
  VIEWER: 'VIEWER',
};
export const USER_ROLES = Object.values(USER_ROLE);

export const PERMISSION = {
  DASHBOARD_READ: 'dashboard:read',
  TRANSACTIONS_READ: 'transactions:read',
  TRANSACTIONS_INGEST: 'transactions:ingest',
  ALERTS_READ: 'alerts:read',
  ALERTS_ASSIGN: 'alerts:assign',
  ALERTS_UPDATE_STATUS: 'alerts:update-status',
  ALERTS_NOTE_CREATE: 'alerts:note-create',
  ANALYTICS_READ: 'analytics:read',
  ANALYTICS_EXPORT: 'analytics:export',
  ACCOUNTS_READ: 'accounts:read',
  SIMULATOR_READ: 'simulator:read',
  SIMULATOR_MANAGE: 'simulator:manage',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  AUDIT_READ: 'audit:read',
};
export const PERMISSIONS = Object.values(PERMISSION);

const VIEWER_PERMISSIONS = [
  PERMISSION.DASHBOARD_READ,
  PERMISSION.TRANSACTIONS_READ,
  PERMISSION.ALERTS_READ,
  PERMISSION.ANALYTICS_READ,
  PERMISSION.ACCOUNTS_READ,
];

const INVESTIGATOR_PERMISSIONS = [
  ...VIEWER_PERMISSIONS,
  PERMISSION.ALERTS_ASSIGN,
  PERMISSION.ALERTS_UPDATE_STATUS,
  PERMISSION.ALERTS_NOTE_CREATE,
  PERMISSION.ANALYTICS_EXPORT,
  PERMISSION.SETTINGS_READ,
  PERMISSION.SIMULATOR_READ,
];

const ANALYST_PERMISSIONS = [
  ...INVESTIGATOR_PERMISSIONS,
  PERMISSION.TRANSACTIONS_INGEST,
  PERMISSION.SIMULATOR_MANAGE,
];

/** Role -> permission list. ADMIN implicitly receives every permission. */
export const ROLE_PERMISSIONS = {
  [USER_ROLE.VIEWER]: VIEWER_PERMISSIONS,
  [USER_ROLE.INVESTIGATOR]: INVESTIGATOR_PERMISSIONS,
  [USER_ROLE.ANALYST]: ANALYST_PERMISSIONS,
  [USER_ROLE.ADMIN]: PERMISSIONS,
};

/** Returns the permission list for a role, or an empty list for unknown roles. */
export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** True when the role grants the given permission. */
export function roleHasPermission(role, permission) {
  return permissionsForRole(role).includes(permission);
}

/**
 * Roles that may be assigned to an alert as the investigating user. A VIEWER
 * cannot be made an investigator because it has no write permissions.
 */
export const ASSIGNABLE_INVESTIGATOR_ROLES = [
  USER_ROLE.ADMIN,
  USER_ROLE.ANALYST,
  USER_ROLE.INVESTIGATOR,
];

/** Human-readable role descriptions shown in the user administration UI. */
export const ROLE_DESCRIPTIONS = {
  [USER_ROLE.ADMIN]:
    'Full access, including user administration, detection settings and audit logs.',
  [USER_ROLE.ANALYST]:
    'Monitors transactions, manages alerts and the simulator, and exports analytics.',
  [USER_ROLE.INVESTIGATOR]:
    'Reviews alerts, records investigation notes and sets investigation outcomes.',
  [USER_ROLE.VIEWER]: 'Read-only access to dashboards, transactions and alerts.',
};
