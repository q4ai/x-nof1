/**
 * Agent 请求日志记录工具
 */
import type { Client } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import { getChinaTimeISO } from "../utils/timeUtils";

const logger = createLogger({
  name: "agent-request-logs",
  level: "info",
});

export type AgentRequestLogStatus = "success" | "error";

export interface AgentRequestLogInput {
  iteration?: number;
  modelName: string;
  instructions: string;
  prompt: string;
  response?: string | null;
  status: AgentRequestLogStatus;
  errorMessage?: string | null;
  createdAt?: string;
  outputDurationMs?: number | null;
}

export function summarizeAgentResponseText(text: string | null, maxLength = 200): string {
  if (!text) {
    return "";
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export async function insertAgentRequestLog(client: Client, payload: AgentRequestLogInput): Promise<void> {
  const {
    iteration,
    modelName,
    instructions,
    prompt,
    response,
    status,
    errorMessage,
    createdAt,
    outputDurationMs,
  } = payload;

  const timestamp = createdAt ?? getChinaTimeISO();
  const summary = summarizeAgentResponseText(response ?? errorMessage ?? "");

  try {
    await client.execute({
      sql: `INSERT INTO agent_request_logs
        (created_at, iteration, model_name, instructions, prompt, response, response_summary, status, error_message, output_duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      args: [
        timestamp,
        iteration ?? null,
        modelName,
        instructions,
        prompt,
        response ?? null,
        summary,
        status,
        errorMessage ?? null,
        typeof outputDurationMs === "number" && Number.isFinite(outputDurationMs)
          ? Math.max(0, Math.round(outputDurationMs))
          : null,
      ],
    });
  } catch (error) {
    logger.error("写入 agent_request_logs 失败", error as any);
  }
}
