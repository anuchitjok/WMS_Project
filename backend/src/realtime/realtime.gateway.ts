import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
  namespace: '/ws',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  emitInventoryUpdate(payload: unknown) {
    this.server.emit('inventory:update', payload);
  }

  emitRequestUpdate(payload: unknown) {
    this.server.emit('request:update', payload);
  }

  emitDashboardRefresh() {
    this.server.emit('dashboard:refresh', { ts: new Date() });
  }
}
