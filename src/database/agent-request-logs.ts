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
	accountId?: string;
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

export interface ParsedDecisionPlanSummary {
	summary: string;
	riskSummary: string;
	plannedActions: number;
}

export interface ParsedExecutionSummary {
	approvedActions: number;
	executedActions: number;
	rejectedReasons: string[];
	holdReasons: string[];
}

export interface ParsedDecisionResponseSummary {
	decisionPlan: ParsedDecisionPlanSummary | null;
	executionSummary: ParsedExecutionSummary | null;
}

interface JsonLikeRecord {
	[key: string]: unknown;
}

const APPROVAL_MARKER = "\n\n[Approval]\n";

function tryParseJsonRecord(text: string): JsonLikeRecord | null {
	const normalized = text.trim();
	if (!normalized) {
		return null;
	}

	const candidates = [normalized];
	const firstBrace = normalized.indexOf("{");
	const lastBrace = normalized.lastIndexOf("}");
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		candidates.push(normalized.slice(firstBrace, lastBrace + 1));
	}

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as JsonLikeRecord;
			}
		} catch {
			// 忽略非法 JSON，继续尝试下一个候选
		}
	}

	return null;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((item) => item !== null && item !== undefined)
		.map((item) => String(item).trim())
		.filter((item) => item.length > 0);
}

function toFiniteNumber(value: unknown): number {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : 0;
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

export function parseDecisionResponseSummary(
	text: string | null | undefined,
): ParsedDecisionResponseSummary {
	if (!text || typeof text !== "string") {
		return {
			decisionPlan: null,
			executionSummary: null,
		};
	}

	const markerIndex = text.lastIndexOf(APPROVAL_MARKER);
	const decisionText = markerIndex >= 0 ? text.slice(0, markerIndex) : text;
	const approvalText = markerIndex >= 0
		? text.slice(markerIndex + APPROVAL_MARKER.length)
		: "";

	const decisionRecord = tryParseJsonRecord(decisionText);
	const approvalRecord = tryParseJsonRecord(approvalText);

	const decisionPlan = decisionRecord
		? {
			summary:
				typeof decisionRecord.summary === "string"
					? decisionRecord.summary.trim()
					: "",
			riskSummary:
				typeof decisionRecord.riskSummary === "string"
					? decisionRecord.riskSummary.trim()
					: "",
			plannedActions: Array.isArray(decisionRecord.actions)
				? decisionRecord.actions.length
				: 0,
		}
		: null;

	const executionSummary = approvalRecord
		? {
			approvedActions: toFiniteNumber(approvalRecord.approvedActions),
			executedActions: toFiniteNumber(approvalRecord.executedActions),
			rejectedReasons: toStringArray(approvalRecord.rejectedReasons),
			holdReasons: toStringArray(approvalRecord.holdReasons),
		}
		: null;

	return {
		decisionPlan,
		executionSummary,
	};
}

export function summarizeAgentResponseText(
	text: string | null,
	maxLength = 200,
): string {
	if (!text) {
		return "";
	}
	const parsedSummary = parseDecisionResponseSummary(text);
	const preferredText =
		parsedSummary.decisionPlan?.summary ||
		parsedSummary.decisionPlan?.riskSummary ||
		text;
	const normalized = preferredText.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, maxLength - 1)}…`;
}

export async function insertAgentRequestLog(
	client: Client,
	payload: AgentRequestLogInput,
): Promise<void> {
	const {
		accountId,
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
        (account_id, created_at, iteration, model_name, instructions, prompt, response, response_summary, status, error_message, output_duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				accountId || "default",
				timestamp,
				iteration ?? null,
				modelName,
				instructions,
				prompt,
				response ?? null,
				summary,
				status,
				errorMessage ?? null,
				outputDurationMs ?? null,
			],
		});
	} catch (error: any) {
		logger.error(`Failed to insert agent request log: ${error.message}`);
	}
}
