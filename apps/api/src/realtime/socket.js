import { Server } from 'socket.io';
import {
  PERMISSION,
  SOCKET_ERROR,
  SOCKET_EVENT,
  SOCKET_ROOM,
  permissionsForRole,
} from '@fraudlens/shared/constants';
import { env } from '../config/env.js';
import { moduleLogger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { verifySessionToken } from '../modules/auth/token.service.js';
import { registerSocketServer } from './events.js';

const log = moduleLogger('socket');

/** Parses the session cookie out of a raw `Cookie` header. */
function tokenFromCookieHeader(header) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === env.AUTH_COOKIE_NAME) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

/**
 * Authenticates a socket handshake.
 *
 * Accepts the same credentials as the REST API: the httpOnly session cookie
 * (how the browser client connects) or an explicit token in the handshake auth
 * payload (how a programmatic client connects). As with HTTP, the user record
 * is re-read from the database, so a deactivated account cannot hold a live
 * socket open.
 */
async function authenticateSocket(socket, next) {
  try {
    const handshake = socket.handshake;
    const token =
      handshake.auth?.token ||
      tokenFromCookieHeader(handshake.headers?.cookie) ||
      (typeof handshake.headers?.authorization === 'string' &&
      handshake.headers.authorization.startsWith('Bearer ')
        ? handshake.headers.authorization.slice(7)
        : null);

    if (!token) {
      const error = new Error('Authentication is required');
      error.data = { code: SOCKET_ERROR.UNAUTHENTICATED };
      next(error);
      return;
    }

    const payload = verifySessionToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      const error = new Error('Your account is not active');
      error.data = { code: SOCKET_ERROR.UNAUTHENTICATED };
      next(error);
      return;
    }

    socket.data.user = { ...user, permissions: permissionsForRole(user.role) };
    next();
  } catch (error) {
    const wrapped = new Error('Invalid session');
    wrapped.data = { code: SOCKET_ERROR.UNAUTHENTICATED, detail: error.message };
    next(wrapped);
  }
}

/**
 * Joins a socket to the rooms its permissions allow.
 *
 * Subscription is server-decided: a client cannot request a room. This is what
 * makes the room-per-permission model an actual authorization boundary rather
 * than a convention the client is trusted to honour.
 */
function joinPermittedRooms(socket) {
  const { permissions } = socket.data.user;
  const joined = [];

  if (permissions.includes(PERMISSION.TRANSACTIONS_READ)) {
    socket.join(SOCKET_ROOM.TRANSACTIONS);
    joined.push(SOCKET_ROOM.TRANSACTIONS);
  }
  if (permissions.includes(PERMISSION.ALERTS_READ)) {
    socket.join(SOCKET_ROOM.ALERTS);
    joined.push(SOCKET_ROOM.ALERTS);
  }
  if (permissions.includes(PERMISSION.ALERTS_UPDATE_STATUS)) {
    socket.join(SOCKET_ROOM.INVESTIGATORS);
    joined.push(SOCKET_ROOM.INVESTIGATORS);
  }
  if (permissions.includes(PERMISSION.SIMULATOR_READ)) {
    socket.join(SOCKET_ROOM.SIMULATOR);
    joined.push(SOCKET_ROOM.SIMULATOR);
  }
  return joined;
}

/**
 * Attaches a Socket.IO server to an HTTP server.
 *
 * @param {import('node:http').Server} httpServer
 * @returns {Server}
 */
export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: env.allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    // Keeps a dead connection from lingering long enough to look alive.
    pingTimeout: 20_000,
    pingInterval: 25_000,
    maxHttpBufferSize: 1e6,
    // Clients are listeners; they never push transaction data over the socket.
    connectTimeout: 10_000,
  });

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    const rooms = joinPermittedRooms(socket);
    log.debug({ socketId: socket.id, userId: socket.data.user.id, rooms }, 'Socket connected');

    // Tells the client what it is subscribed to, which lets the UI show an
    // accurate connection state instead of guessing.
    socket.emit('connection:ready', {
      userId: socket.data.user.id,
      role: socket.data.user.role,
      rooms,
      serverTime: new Date().toISOString(),
    });

    // A client that reconnects must refetch authoritative state over REST
    // rather than assume it missed nothing; this event is the signal to do so.
    socket.on('client:resync', () => {
      socket.emit('server:resync', { serverTime: new Date().toISOString(), rooms });
    });

    socket.on('disconnect', (reason) => {
      log.debug({ socketId: socket.id, reason }, 'Socket disconnected');
    });

    socket.on('error', (error) => {
      log.warn({ socketId: socket.id, err: error }, 'Socket error');
    });
  });

  registerSocketServer(io);
  return io;
}

export { SOCKET_EVENT, SOCKET_ROOM, authenticateSocket, joinPermittedRooms };
