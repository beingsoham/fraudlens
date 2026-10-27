/** Socket.IO event names and room names shared by the server and the client. */

export const SOCKET_EVENT = {
  TRANSACTION_CREATED: 'transaction:created',
  TRANSACTION_ASSESSED: 'transaction:assessed',
  ALERT_CREATED: 'alert:created',
  ALERT_UPDATED: 'alert:updated',
  SIMULATOR_STATUS: 'simulator:status',
};
export const SOCKET_EVENTS = Object.values(SOCKET_EVENT);

/**
 * Rooms a socket may be joined to, based on the authenticated user's
 * permissions. Events are emitted to rooms, never broadcast to everyone, so a
 * VIEWER never receives investigator-only payload fields.
 */
export const SOCKET_ROOM = {
  /** Anyone who may read transactions. Receives redacted transaction events. */
  TRANSACTIONS: 'room:transactions',
  /** Anyone who may read alerts. Receives alert events. */
  ALERTS: 'room:alerts',
  /** Users who may act on alerts. Receives assignment and note metadata. */
  INVESTIGATORS: 'room:investigators',
  /** Users who may read simulator state. */
  SIMULATOR: 'room:simulator',
};

export const SOCKET_ERROR = {
  UNAUTHENTICATED: 'socket:unauthenticated',
  FORBIDDEN: 'socket:forbidden',
};
