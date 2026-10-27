import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_EVENT } from '@fraudlens/shared/constants';
import { useAuth } from './AuthContext.jsx';

/**
 * Socket.IO connection.
 *
 * One socket for the whole application, created when a user signs in and torn
 * down on sign-out. Components subscribe through `useSocketEvent`, which
 * attaches and detaches exactly one listener per mount — the usual bug in this
 * pattern is a listener re-registered on every render, which makes each event
 * fire N times and the list jump.
 *
 * Events are treated as *hints*, never as the source of truth. On reconnect the
 * client refetches from the REST API, because anything that happened while the
 * socket was down was never delivered.
 */

const SocketContext = createContext(null);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? undefined;

export function SocketProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [rooms, setRooms] = useState([]);
  /** Bumped on every reconnect so data hooks know to refetch. */
  const [reconnectCount, setReconnectCount] = useState(0);
  const [lastError, setLastError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) {
      // Tear down on sign-out so a signed-out tab holds no live subscription.
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setConnected(false);
      setRooms([]);
      return undefined;
    }

    // The handshake authenticates with the same httpOnly session cookie as the
    // REST API, so no token has to be read by or stored in client script.
    const socket = io(SOCKET_URL, {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      setLastError(null);
    };
    const handleReady = (payload) => setRooms(payload.rooms ?? []);
    const handleDisconnect = () => setConnected(false);
    const handleReconnect = () => {
      // The signal for every data hook to refetch authoritative state.
      setReconnectCount((count) => count + 1);
    };
    const handleConnectError = (error) => {
      setConnected(false);
      setLastError(error?.message ?? 'Realtime connection failed');
    };

    socket.on('connect', handleConnect);
    socket.on('connection:ready', handleReady);
    socket.on('disconnect', handleDisconnect);
    socket.io.on('reconnect', handleReconnect);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connection:ready', handleReady);
      socket.off('disconnect', handleDisconnect);
      socket.io.off('reconnect', handleReconnect);
      socket.off('connect_error', handleConnectError);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
    // Keyed on the user id so switching accounts rebuilds the connection with
    // the new identity rather than reusing the previous one's rooms.
  }, [isAuthenticated, user?.id]);

  const value = useMemo(
    () => ({
      socket: socketRef.current,
      socketRef,
      connected,
      rooms,
      reconnectCount,
      lastError,
    }),
    [connected, rooms, reconnectCount, lastError],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used inside a SocketProvider');
  }
  return context;
}

/**
 * Subscribes to one socket event for the lifetime of the component.
 *
 * The handler is held in a ref and the effect depends only on the event name,
 * so passing an inline arrow function does not re-register the listener on
 * every render — which would otherwise deliver each event once per render the
 * component had performed.
 */
export function useSocketEvent(event, handler, { enabled = true } = {}) {
  const { socketRef, connected } = useSocket();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !enabled) return undefined;

    const listener = (...args) => handlerRef.current?.(...args);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
    // `connected` is included so the listener is re-attached to a socket that
    // was replaced after a failed connection.
  }, [event, enabled, socketRef, connected]);
}

export { SOCKET_EVENT };
