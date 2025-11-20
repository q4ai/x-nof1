/**
 * 紧急通知工具 - 当出现紧急情况时，通过配置的 URL 发送通知
 */

import { createTool } from "@voltagent/core";
import { z } from "zod";
import { createLogger } from "../../utils/loggerUtils";
import { RISK_PARAMS } from "../../config/riskParams.new";

const logger = createLogger({
  name: "emergency-notice",
  level: "info",
});

/**
 * 发送紧急通知工具
 * 当 AI 检测到重复交易失败、异常情况或其他紧急状况时，调用此工具
 * 通过配置的 GET 请求 URL 发送通知（例如：Webhook、企业微信、钉钉等）
 */
export const sendEmergencyNoticeTool = createTool({
  name: "sendEmergencyNotice",
  description: `Send emergency notification when critical situations occur (e.g., repeated trading failures, system errors, abnormal market conditions).
  
This tool triggers a GET request to the configured emergency notification URL. Use this when:
- Multiple consecutive trades fail to execute
- Critical system errors prevent normal operation
- Abnormal market conditions threaten account safety
- Any urgent situation requiring human intervention

The notification URL is configured in the system settings (EMERGENCY_NOTICE_URL).`,

  parameters: z.object({
    reason: z
      .string()
      .describe(
        "Brief description of the emergency situation (e.g., 'Repeated trading failures: 5 consecutive open position attempts failed')"
      ),
    severity: z
      .enum(["low", "medium", "high", "critical"])
      .describe(
        "Severity level: low (informational), medium (attention needed), high (urgent), critical (immediate action required)"
      )
      .default("high"),
    details: z
      .string()
      .optional()
      .describe(
        "Additional details about the situation, error messages, or context"
      ),
  }),

  execute: async (args) => {
    const { reason, severity, details } = args;
    const emergencyUrl = RISK_PARAMS.EMERGENCY_NOTICE_URL;

    if (!emergencyUrl || emergencyUrl.trim() === "") {
      logger.warn(
        "紧急通知 URL 未配置，跳过通知发送",
        { reason, severity, details }
      );
      return {
        success: false,
        message: "Emergency notice URL not configured",
        reason,
        severity,
      };
    }

    try {
      const url = new URL(emergencyUrl);
      url.searchParams.append("reason", reason);
      url.searchParams.append("severity", severity);
      if (details) {
        url.searchParams.append("details", details);
      }

      const response = await fetch(url.toString());
      const responseText = await response.text();

      if (response.ok) {
        logger.info("紧急通知发送成功", { reason, severity });
        return {
          success: true,
          message: "Emergency notice sent successfully",
          reason,
          severity,
          url: emergencyUrl,
          response: responseText,
        };
      } else {
        logger.error("紧急通知发送失败", {
          status: response.status,
          statusText: response.statusText,
          response: responseText,
        });
        return {
          success: false,
          message: `Failed to send emergency notice: ${response.status} ${response.statusText}`,
          reason,
          severity,
          error: responseText,
        };
      }
    } catch (error: any) {
      logger.error("发送紧急通知时发生异常", error);
      return {
        success: false,
        message: `Error sending emergency notice: ${error.message}`,
        reason,
        severity,
        error: error.message,
      };
    }
  },
});
