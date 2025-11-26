/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * WebSocket 服务 - 用于实时推送交易执行状态
 */
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import { createLogger } from "../utils/loggerUtils";

const logger = createLogger({
  name: "websocket-service",
  level: "info",
});

const WS_READY_STATE_OPEN = 1;

// 交易执行状态消息类型
export interface TradingStatusMessage {
  type: "trading_status";
  status: "idle" | "preparing" | "collecting_data" | "analyzing" | "ai_deciding" | "executing_trades" | "completed" | "error";
  message: string;
  timestamp: string;
  trigger?: "manual" | "scheduled";
  data?: Record<string, unknown>;
}

export interface PricesUpdateMessage {
  type: "prices_update";
  timestamp: string;
  prices: Array<{
    symbol: string;
    price: number;
    delta?: number | null;
    percent?: number | null;
  }>;
}

export interface PositionsUpdateMessage {
  type: "positions_update";
  timestamp: string;
  positions: Array<Record<string, unknown>>;
}

export interface CandlesSnapshotMessage {
  type: "candles_snapshot";
  timestamp: string;
  symbol: string;
  interval: string;
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
}

export interface PongMessage {
  type: "pong";
  timestamp: string;
}

// Strategy Task 状态消息类型
export interface InstanceStatusMessage {
  type: "instance_status";
  instanceId: number;
  status: "idle" | "executing" | "error";
  message: string;
  timestamp: string;
}

export type DashboardMessage =
  | TradingStatusMessage
  | PricesUpdateMessage
  | PositionsUpdateMessage
  | CandlesSnapshotMessage
  | PongMessage
  | InstanceStatusMessage;

type ClientLifecycleHandler = (client: WebSocket) => void;
type ClientMessageHandler = (client: WebSocket, payload: unknown) => void;

// WebSocket 客户端连接管理
class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private connectHandlers: ClientLifecycleHandler[] = [];
  private disconnectHandlers: ClientLifecycleHandler[] = [];
  private messageHandlers: ClientMessageHandler[] = [];

  /**
   * 初始化 WebSocket 服务器
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ 
      server,
      path: "/ws/trading-status"
    });

    this.wss.on("connection", (ws: WebSocket) => {
      logger.info("新的 WebSocket 客户端连接");
      this.clients.add(ws);

      // 发送初始状态
      this.sendToClient(ws, {
        type: "trading_status",
        status: "idle",
        message: "连接成功",
        timestamp: new Date().toISOString(),
      });

      for (const handler of this.connectHandlers) {
        try {
          handler(ws);
        } catch (error) {
          logger.error("WebSocket 连接回调执行失败:", error);
        }
      }

      ws.on("message", (raw) => {
        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString());
        } catch (error) {
          logger.warn("收到无法解析的 WebSocket 消息", error);
          return;
        }

        for (const handler of this.messageHandlers) {
          try {
            handler(ws, payload);
          } catch (error) {
            logger.error("WebSocket 消息处理失败:", error);
          }
        }
      });

      const handleDisconnect = () => {
        if (!this.clients.delete(ws)) {
          return;
        }

        for (const handler of this.disconnectHandlers) {
          try {
            handler(ws);
          } catch (error) {
            logger.error("WebSocket 断开回调执行失败:", error);
          }
        }
      };

      ws.on("close", () => {
        logger.info("WebSocket 客户端断开连接");
        handleDisconnect();
      });

      ws.on("error", (error) => {
        logger.error("WebSocket 连接错误:", error);
        handleDisconnect();
      });
    });

    logger.info("WebSocket 服务器已启动，路径: /ws/trading-status");
  }

  onConnect(handler: ClientLifecycleHandler): void {
    this.connectHandlers.push(handler);
  }

  onDisconnect(handler: ClientLifecycleHandler): void {
    this.disconnectHandlers.push(handler);
  }

  onMessage(handler: ClientMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  send(client: WebSocket, message: DashboardMessage): void {
    this.sendToClient(client, message);
  }

  /**
   * 向单个客户端发送消息
   */
  private sendToClient(client: WebSocket, message: DashboardMessage): void {
    try {
      if (client.readyState === WS_READY_STATE_OPEN) {
        client.send(JSON.stringify(message));
      }
    } catch (error) {
      logger.error("发送 WebSocket 消息失败:", error);
    }
  }

  /**
   * 广播消息到所有连接的客户端
   */
  broadcast(message: DashboardMessage, filter?: (client: WebSocket) => boolean): void {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    for (const client of this.clients) {
      if (filter && !filter(client)) {
        continue;
      }
      try {
        if (client.readyState === WS_READY_STATE_OPEN) {
          client.send(messageStr);
          sentCount++;
        }
      } catch (error) {
        logger.error("广播 WebSocket 消息失败:", error);
        this.clients.delete(client);
      }
    }

    if (sentCount > 0) {
      logger.debug(`WebSocket 消息已广播到 ${sentCount} 个客户端: ${message.type}`);
    }
  }

  /**
   * 推送交易执行状态
   */
  pushTradingStatus(
    status: TradingStatusMessage["status"],
    message: string,
    trigger?: "manual" | "scheduled",
    data?: Record<string, unknown>
  ): void {
    this.broadcast({
      type: "trading_status",
      status,
      message,
      timestamp: new Date().toISOString(),
      trigger,
      data,
    });
  }

  /**
   * 推送 Strategy Task 执行状态
   */
  pushInstanceStatus(
    instanceId: number,
    status: InstanceStatusMessage["status"],
    message: string
  ): void {
    this.broadcast({
      type: "instance_status",
      instanceId,
      status,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 获取当前连接的客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  getClients(): Iterable<WebSocket> {
    return this.clients;
  }

  /**
   * 关闭 WebSocket 服务器
   */
  close(): void {
    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
      logger.info("WebSocket 服务器已关闭");
    }
  }
}

// 导出单例
export const websocketService = new WebSocketService();

export type WebSocketClient = WebSocket;
