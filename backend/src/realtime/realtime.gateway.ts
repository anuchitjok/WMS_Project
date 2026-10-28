import { Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { hasAccess, AccessPrincipal } from '../auth/access';
import { scopedWarehouseIds } from '../common/warehouse-scope';

/**
 * Authenticated realtime channel.
 *
 * - The handshake must carry the same JWT access token the REST API uses
 *   (`auth: { token }` or `Authorization: Bearer …`). It goes through the
 *   same JwtStrategy.validate as HTTP requests: inactive / deleted users and
 *   revoked tokens (TokenBlocklist) are refused.
 * - Sockets are disconnected when the token expires and are re-validated
 *   periodically, so logout, deactivation or permission removal take effect
 *   without waiting for expiry.
 * - Nothing is broadcast to everyone. Inventory events go to users who can
 *   read inventory, request events to users who can read requests, narrowed
 *   to their warehouses when the event names one.
 * - Payloads are reduced to an action name and identifiers: clients use the
 *   event only as a "re-fetch through the REST API" signal.
 */

export const ROOM = {
  inventory: 'perm:inventory',
  request: 'perm:request',
  dashboard: 'perm:dashboard',
  user: (id: string) => `user:${id}`,
  /** Users whose warehouse scope includes this warehouse. */
  warehouse: (id: string) => `wh:${id}`,
  /** Users not limited to specific warehouses. */
  allWarehouses: 'wh:*',
} as const;

const INVENTORY_READ = { permissions: ['inventory.read'], legacyRoles: 'ANY' as const };
const REQUEST_READ = { permissions: ['request.read'], legacyRoles: 'ANY' as const };

const REVALIDATE_MS = 2 * 60_000;
const SAFE_KEYS = ['action', 'status', 'taskId', 'itemId', 'requestId', 'refNumber', 'shipmentId', 'shipmentRef', 'stockItemId'];

interface SocketPrincipal extends AccessPrincipal {
  id: string;
  roleKey?: string | null;
  warehouseIds?: string[];
}

export function sanitizePayload(payload: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ts: new Date().toISOString() };
  if (!payload || typeof payload !== 'object') return out;
  const p = payload as Record<string, unknown>;
  for (const k of SAFE_KEYS) {
    const v = p[k];
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  const item = p.item as Record<string, unknown> | undefined;
  if (item && typeof item.id === 'string') out.stockItemId = item.id;
  return out;
}

function warehouseOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.warehouseId === 'string') return p.warehouseId;
  const item = p.item as Record<string, unknown> | undefined;
  return item && typeof item.warehouseId === 'string' ? item.warehouseId : null;
}

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
  namespace: '/ws',
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Namespace;

  private readonly logger = new Logger(RealtimeGateway.name);
  private revalidateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly strategy: JwtStrategy,
  ) {}

  afterInit(server: Namespace) {
    // Handshake middleware: an unauthenticated client never completes the
    // connection, so it cannot receive a single event.
    server.use((socket, next) => {
      this.authenticate(socket)
        .then(() => next())
        .catch(() => next(new Error('Unauthorized')));
    });
    this.revalidateTimer = setInterval(() => void this.revalidateAll(), REVALIDATE_MS);
    this.revalidateTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
  }

  private tokenOf(socket: Socket): string | null {
    const fromAuth = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth.replace(/^Bearer\s+/i, '');
    const header = socket.handshake.headers?.authorization;
    if (typeof header === 'string' && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '');
    return null;
  }

  /** Verifies the token and attaches the principal + expiry to the socket. Throws when not allowed. */
  async authenticate(socket: Socket): Promise<SocketPrincipal> {
    const token = this.tokenOf(socket);
    if (!token) throw new Error('missing token');
    const payload = this.jwt.verify<{ sub: string; username: string; role: string; jti?: string; exp?: number }>(token);
    const principal = (await this.strategy.validate(payload)) as SocketPrincipal;
    socket.data.user = principal;
    socket.data.payload = payload;
    return principal;
  }

  /** Rooms a principal may be in, derived from the same rules as REST access. */
  roomsFor(user: SocketPrincipal): string[] {
    const rooms = [ROOM.user(user.id), ROOM.dashboard];
    if (hasAccess(user, INVENTORY_READ)) rooms.push(ROOM.inventory);
    if (hasAccess(user, REQUEST_READ)) rooms.push(ROOM.request);
    const scope = scopedWarehouseIds(user);
    if (scope) rooms.push(...scope.map(ROOM.warehouse));
    else rooms.push(ROOM.allWarehouses);
    return rooms;
  }

  async handleConnection(client: Socket) {
    const user = client.data.user as SocketPrincipal | undefined;
    if (!user) {
      client.disconnect(true);
      return;
    }
    await client.join(this.roomsFor(user));
    const exp = (client.data.payload as { exp?: number } | undefined)?.exp;
    if (exp) {
      const ms = exp * 1000 - Date.now();
      const t = setTimeout(() => {
        client.emit('session:expired');
        client.disconnect(true);
      }, Math.max(0, ms));
      t.unref?.();
      client.data.expiryTimer = t;
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data?.expiryTimer) clearTimeout(client.data.expiryTimer);
  }

  /** Re-checks every socket: revoked token, deactivated user or changed permissions. */
  async revalidateAll() {
    if (!this.server) return;
    const sockets = await this.server.fetchSockets().catch(() => []);
    for (const remote of sockets) {
      const socket = this.server.sockets.get(remote.id);
      if (!socket) continue;
      try {
        const payload = socket.data.payload;
        const user = (await this.strategy.validate(payload)) as SocketPrincipal;
        socket.data.user = user;
        const wanted = new Set(this.roomsFor(user));
        for (const room of socket.rooms) {
          if (room !== socket.id && !wanted.has(room)) await socket.leave(room);
        }
        await socket.join([...wanted]);
      } catch {
        socket.emit('session:expired');
        socket.disconnect(true);
      }
    }
  }

  private emitScoped(permRoom: string, event: string, payload: unknown) {
    if (!this.server) return;
    const wh = warehouseOf(payload);
    const body = sanitizePayload(payload);
    // Socket.IO room targeting is a union, so a warehouse-specific event is
    // delivered by checking each permitted socket for the warehouse room.
    if (!wh) {
      this.server.to(permRoom).emit(event, body);
      return;
    }
    this.server
      .in(permRoom)
      .fetchSockets()
      .then((sockets) => {
        for (const s of sockets) {
          if (s.rooms.has(ROOM.allWarehouses) || s.rooms.has(ROOM.warehouse(wh))) s.emit(event, body);
        }
      })
      .catch((e) => this.logger.warn(`emit ${event} failed: ${e?.message ?? e}`));
  }

  emitInventoryUpdate(payload: unknown) {
    this.emitScoped(ROOM.inventory, 'inventory:update', payload);
  }

  emitRequestUpdate(payload: unknown) {
    this.emitScoped(ROOM.request, 'request:update', payload);
  }

  emitDashboardRefresh() {
    this.server?.to(ROOM.dashboard).emit('dashboard:refresh', { ts: new Date() });
  }

  /** Per-user push (notifications). */
  emitToUser(userId: string, event: string, payload: Record<string, unknown>) {
    this.server?.to(ROOM.user(userId)).emit(event, payload);
  }

  /** Coarse "something changed" signal to every authenticated client. */
  emitToAuthenticated(event: string, payload: Record<string, unknown>) {
    this.server?.to(ROOM.dashboard).emit(event, payload);
  }
}
