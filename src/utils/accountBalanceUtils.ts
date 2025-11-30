/**
 * 账户资产工具函数
 * 用于判断不同交易所返回的 total 字段是否已经包含未实现盈亏
 */
const EQUITY_TOTAL_PROVIDERS = new Set(["bitget", "gate"]);

/**
 * 判断当前交易所返回的 total 是否已经包含未实现盈亏
 * 如果已包含，则在计算总资产时不需要再次叠加 unrealisedPnl
 */
export function totalIncludesUnrealisedPnl(
	provider?: string | null,
): boolean {
	if (!provider) {
		return false;
	}
	return EQUITY_TOTAL_PROVIDERS.has(provider);
}
