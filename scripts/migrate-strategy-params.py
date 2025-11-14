#!/usr/bin/env python3
"""
将 strategyControls.ts 中的硬编码参数迁移到策略文件的提示词中
"""

import json
import os
from pathlib import Path

# 定义策略配置
STRATEGIES_CONFIG = {
    "conservative": {
        "volatility": {
            "high": {"leverage": 0.6, "position": 0.7},
            "normal": {"leverage": 1, "position": 1},
            "low": {"leverage": 1, "position": 1}
        },
        "texts": {
            "zh": {
                "volatility_section": "\n\n市场波动率自适应调整（基于 ATR 百分比）：\n- 高波动市场（ATR > 5%）：杠杆×0.6，仓位×0.7，极度保守防止爆仓。\n- 正常波动市场（2% ≤ ATR ≤ 5%）：使用标准杠杆和仓位。\n- 低波动市场（ATR < 2%）：保持标准参数，不增加风险。\n- 在开仓前检查市场数据中的 ATR 指标，根据波动率级别调整参数。"
            },
            "en": {
                "volatility_section": "\n\nMarket Volatility Adaptive Adjustment (based on ATR percentage):\n- High volatility market (ATR > 5%): Leverage×0.6, Position×0.7, ultra-conservative to prevent liquidation.\n- Normal volatility market (2% ≤ ATR ≤ 5%): Use standard leverage and position.\n- Low volatility market (ATR < 2%): Keep standard parameters, do not increase risk.\n- Check ATR indicator in market data before opening position, adjust parameters according to volatility level."
            },
            "ja": {
                "volatility_section": "\n\n市場ボラティリティ適応調整（ATR百分率に基づく）：\n- 高ボラティリティ市場（ATR > 5%）：レバレッジ×0.6、ポジション×0.7、清算を防ぐため超保守的。\n- 通常ボラティリティ市場（2% ≤ ATR ≤ 5%）：標準レバレッジとポジションを使用。\n- 低ボラティリティ市場（ATR < 2%）：標準パラメータを維持、リスクを増やさない。\n- ポジションを開く前に市場データのATR指標を確認し、ボラティリティレベルに応じてパラメータを調整。"
            }
        }
    },
    "balanced": {
        "volatility": {
            "high": {"leverage": 0.7, "position": 0.8},
            "normal": {"leverage": 1, "position": 1},
            "low": {"leverage": 1.1, "position": 1}
        },
        "texts": {
            "zh": {
                "volatility_section": "\n\n市场波动率自适应调整（基于 ATR 百分比）：\n- 高波动市场（ATR > 5%）：杠杆×0.7，仓位×0.8，降低风险暴露。\n- 正常波动市场（2% ≤ ATR ≤ 5%）：使用标准杠杆和仓位。\n- 低波动市场（ATR < 2%）：杠杆×1.1，保持标准仓位，适度提高收益。\n- 在开仓前检查市场数据中的 ATR 指标，根据波动率级别调整参数。"
            },
            "en": {
                "volatility_section": "\n\nMarket Volatility Adaptive Adjustment (based on ATR percentage):\n- High volatility market (ATR > 5%): Leverage×0.7, Position×0.8, reduce risk exposure.\n- Normal volatility market (2% ≤ ATR ≤ 5%): Use standard leverage and position.\n- Low volatility market (ATR < 2%): Leverage×1.1, keep standard position, moderately increase returns.\n- Check ATR indicator in market data before opening position, adjust parameters according to volatility level."
            },
            "ja": {
                "volatility_section": "\n\n市場ボラティリティ適応調整（ATR百分率に基づく）：\n- 高ボラティリティ市場（ATR > 5%）：レバレッジ×0.7、ポジション×0.8、リスクエクスポージャーを削減。\n- 通常ボラティリティ市場（2% ≤ ATR ≤ 5%）：標準レバレッジとポジションを使用。\n- 低ボラティリティ市場（ATR < 2%）：レバレッジ×1.1、標準ポジションを維持、適度に収益を向上。\n- ポジションを開く前に市場データのATR指標を確認し、ボラティリティレベルに応じてパラメータを調整。"
            }
        }
    },
    "aggressive": {
        "volatility": {
            "high": {"leverage": 0.8, "position": 0.85},
            "normal": {"leverage": 1, "position": 1},
            "low": {"leverage": 1.2, "position": 1.1}
        },
        "texts": {
            "zh": {
                "volatility_section": "\n\n市场波动率自适应调整（基于 ATR 百分比）：\n- 高波动市场（ATR > 5%）：杠杆×0.8，仓位×0.85，适度降低风险。\n- 正常波动市场（2% ≤ ATR ≤ 5%）：使用标准杠杆和仓位。\n- 低波动市场（ATR < 2%）：杠杆×1.2，仓位×1.1，利用稳定环境提高收益。\n- 在开仓前检查市场数据中的 ATR 指标，根据波动率级别调整参数。"
            },
            "en": {
                "volatility_section": "\n\nMarket Volatility Adaptive Adjustment (based on ATR percentage):\n- High volatility market (ATR > 5%): Leverage×0.8, Position×0.85, moderately reduce risk.\n- Normal volatility market (2% ≤ ATR ≤ 5%): Use standard leverage and position.\n- Low volatility market (ATR < 2%): Leverage×1.2, Position×1.1, leverage stable environment to increase returns.\n- Check ATR indicator in market data before opening position, adjust parameters according to volatility level."
            },
            "ja": {
                "volatility_section": "\n\n市場ボラティリティ適応調整（ATR百分率に基づく）：\n- 高ボラティリティ市場（ATR > 5%）：レバレッジ×0.8、ポジション×0.85、リスクを適度に削減。\n- 通常ボラティリティ市場（2% ≤ ATR ≤ 5%）：標準レバレッジとポジションを使用。\n- 低ボラティリティ市場（ATR < 2%）：レバレッジ×1.2、ポジション×1.1、安定した環境を活用して収益を向上。\n- ポジションを開く前に市場データのATR指標を確認し、ボラティリティレベルに応じてパラメータを調整。"
            }
        }
    },
    "ultra-short": {
        "volatility": {
            "high": {"leverage": 0.7, "position": 0.8},
            "normal": {"leverage": 1, "position": 1},
            "low": {"leverage": 1.1, "position": 1.1}
        },
        "texts": {
            "zh": {
                "volatility_section": "\n\n市场波动率自适应调整（基于 ATR 百分比）：\n- 高波动市场（ATR > 5%）：杠杆×0.7，仓位×0.8，防止剧烈波动导致爆仓。\n- 正常波动市场（2% ≤ ATR ≤ 5%）：使用标准杠杆和仓位。\n- 低波动市场（ATR < 2%）：杠杆×1.1，仓位×1.1，利用稳定环境提高收益。\n- 在开仓前检查市场数据中的 ATR 指标，根据波动率级别调整参数。",
                "profit_lock": "\n\n盈利锁定机制：\n- 连续 4 次盈利后自动进入锁定利润模式，下一个决策周期必须评估是否降低仓位或观望。\n- 锁定模式下，即使有新机会也需要更严格的入场条件（成交量需 ≥ 2倍均值，信号需多周期同步确认）。\n- 锁定模式持续到出现一次亏损或主动减仓至总仓位 < 30% 后解除。"
            },
            "en": {
                "volatility_section": "\n\nMarket Volatility Adaptive Adjustment (based on ATR percentage):\n- High volatility market (ATR > 5%): Leverage×0.7, Position×0.8, prevent liquidation from severe fluctuations.\n- Normal volatility market (2% ≤ ATR ≤ 5%): Use standard leverage and position.\n- Low volatility market (ATR < 2%): Leverage×1.1, Position×1.1, leverage stable environment to increase returns.\n- Check ATR indicator in market data before opening position, adjust parameters according to volatility level.",
                "profit_lock": "\n\nProfit Locking Mechanism:\n- After 4 consecutive profitable trades, automatically enter \"Profit Lock Mode\", next decision cycle must evaluate whether to reduce position or wait.\n- In lock mode, even with new opportunities, require stricter entry conditions (volume ≥ 2x average, signals must be confirmed across multiple timeframes).\n- Lock mode continues until one losing trade occurs or active position reduction to total < 30%."
            },
            "ja": {
                "volatility_section": "\n\n市場ボラティリティ適応調整（ATR百分率に基づく）：\n- 高ボラティリティ市場（ATR > 5%）：レバレッジ×0.7、ポジション×0.8、激しい変動による清算を防止。\n- 通常ボラティリティ市場（2% ≤ ATR ≤ 5%）：標準レバレッジとポジションを使用。\n- 低ボラティリティ市場（ATR < 2%）：レバレッジ×1.1、ポジション×1.1、安定した環境を活用して収益を向上。\n- ポジションを開く前に市場データのATR指標を確認し、ボラティリティレベルに応じてパラメータを調整。",
                "profit_lock": "\n\n利益ロックメカニズム:\n- 4回連続利益後、自動的に「利益ロックモード」に入り、次の決定サイクルでポジション削減または様子見を評価する必要があります。\n- ロックモードでは、新しい機会があってもより厳格なエントリー条件が必要（出来高≥2倍平均、シグナルは複数の時間枠で確認）。\n- ロックモードは、1回の損失が発生するか、アクティブなポジション削減で合計<30%になるまで継続。"
            }
        }
    },
    "swing-trend": {
        "volatility": {
            "high": {"leverage": 0.5, "position": 0.6},
            "normal": {"leverage": 1, "position": 1},
            "low": {"leverage": 1.2, "position": 1.1}
        },
        "texts": {
            "zh": {
                "volatility_section": "\n\n市场波动率自适应调整（基于 ATR 百分比）：\n- 高波动市场（ATR > 5%）：杠杆×0.5，仓位×0.6，大幅降低风险暴露。\n- 正常波动市场（2% ≤ ATR ≤ 5%）：使用标准杠杆和仓位。\n- 低波动市场（ATR < 2%）：杠杆×1.2，仓位×1.1，适度提高收益潜力。\n- 在开仓前检查市场数据中的 ATR 指标，根据波动率级别调整参数。",
                "stop_loss": "\n\n分级止损机制（根据杠杆倍数）：\n- 5-7倍杠杆：亏损达 -6% 时止损\n- 8-12倍杠杆：亏损达 -5% 时止损\n- 13倍以上杠杆：亏损达 -4% 时止损\n- 杠杆越高，止损越严格，确保风险可控。",
                "trailing_stop": "\n\n分阶段移动止盈：\n- 阶段1（峰值4-6%）：回撤1.5%时平仓，保底锁定2.5%利润\n- 阶段2（峰值6-10%）：回撤2%时平仓，保底锁定4%利润\n- 阶段3（峰值10-15%）：回撤2.5%时平仓，保底锁定7.5%利润\n- 阶段4（峰值15-25%）：回撤3%时平仓，保底锁定12%利润\n- 阶段5（峰值25%+）：回撤5%时平仓，保底锁定20%利润\n- 随着盈利增长，逐步扩大回撤容忍度，让利润充分奔跑。"
            },
            "en": {
                "volatility_section": "\n\nMarket Volatility Adaptive Adjustment (based on ATR percentage):\n- High volatility market (ATR > 5%): Leverage×0.5, Position×0.6, significantly reduce risk exposure.\n- Normal volatility market (2% ≤ ATR ≤ 5%): Use standard leverage and position.\n- Low volatility market (ATR < 2%): Leverage×1.2, Position×1.1, moderately increase profit potential.\n- Check ATR indicator in market data before opening position, adjust parameters according to volatility level.",
                "stop_loss": "\n\nTiered Stop-Loss Mechanism (based on leverage):\n- 5-7x leverage: Stop loss at -6%\n- 8-12x leverage: Stop loss at -5%\n- 13x+ leverage: Stop loss at -4%\n- Higher leverage requires stricter stop loss to ensure manageable risk.",
                "trailing_stop": "\n\nStaged Trailing Stop:\n- Stage 1 (Peak 4-6%): Close on 1.5% drawdown, lock minimum 2.5% profit\n- Stage 2 (Peak 6-10%): Close on 2% drawdown, lock minimum 4% profit\n- Stage 3 (Peak 10-15%): Close on 2.5% drawdown, lock minimum 7.5% profit\n- Stage 4 (Peak 15-25%): Close on 3% drawdown, lock minimum 12% profit\n- Stage 5 (Peak 25%+): Close on 5% drawdown, lock minimum 20% profit\n- As profits grow, gradually expand drawdown tolerance to let profits run."
            },
            "ja": {
                "volatility_section": "\n\n市場ボラティリティ適応調整（ATR百分率に基づく）：\n- 高ボラティリティ市場（ATR > 5%）：レバレッジ×0.5、ポジション×0.6、リスクエクスポージャーを大幅に削減。\n- 通常ボラティリティ市場（2% ≤ ATR ≤ 5%）：標準レバレッジとポジションを使用。\n- 低ボラティリティ市場（ATR < 2%）：レバレッジ×1.2、ポジション×1.1、適度に収益ポテンシャルを向上。\n- ポジションを開く前に市場データのATR指標を確認し、ボラティリティレベルに応じてパラメータを調整。",
                "stop_loss": "\n\n段階的ストップロスメカニズム（レバレッジに基づく）：\n- 5-7倍レバレッジ：-6%で損切り\n- 8-12倍レバレッジ：-5%で損切り\n- 13倍以上レバレッジ：-4%で損切り\n- レバレッジが高いほど、ストップロスを厳格にし、リスクを管理可能に保つ。",
                "trailing_stop": "\n\n段階的トレーリングストップ：\n- ステージ1（ピーク4-6%）：1.5%ドローダウンでクローズ、最低2.5%利益確定\n- ステージ2（ピーク6-10%）：2%ドローダウンでクローズ、最低4%利益確定\n- ステージ3（ピーク10-15%）：2.5%ドローダウンでクローズ、最低7.5%利益確定\n- ステージ4（ピーク15-25%）：3%ドローダウンでクローズ、最低12%利益確定\n- ステージ5（ピーク25%+）：5%ドローダウンでクローズ、最低20%利益確定\n- 利益が増えるにつれて、ドローダウン許容度を徐々に拡大し、利益を十分に走らせる。"
            }
        }
    },
    "dca": {
        "volatility": {
            "high": {"leverage": 0.6, "position": 0.75},
            "normal": {"leverage": 1, "position": 1},
            "low": {"leverage": 1.15, "position": 1.05}
        },
        "texts": {
            "zh": {
                "volatility_section": "\n\n市场波动率自适应调整（基于 ATR 百分比）：\n- 高波动市场（ATR > 5%）：杠杆×0.6，仓位×0.75，保守应对高风险环境。\n- 正常波动市场（2% ≤ ATR ≤ 5%）：使用标准杠杆和仓位。\n- 低波动市场（ATR < 2%）：杠杆×1.15，仓位×1.05，适度提高收益潜力。\n- 在开仓前检查市场数据中的 ATR 指标，根据波动率级别调整参数。"
            },
            "en": {
                "volatility_section": "\n\nMarket Volatility Adaptive Adjustment (based on ATR percentage):\n- High volatility market (ATR > 5%): Leverage×0.6, Position×0.75, conservative approach in high-risk environment.\n- Normal volatility market (2% ≤ ATR ≤ 5%): Use standard leverage and position.\n- Low volatility market (ATR < 2%): Leverage×1.15, Position×1.05, moderately increase profit potential.\n- Check ATR indicator in market data before opening position, adjust parameters according to volatility level."
            },
            "ja": {
                "volatility_section": "\n\n市場ボラティリティ適応調整（ATR百分率に基づく）：\n- 高ボラティリティ市場（ATR > 5%）：レバレッジ×0.6、ポジション×0.75、高リスク環境で保守的なアプローチ。\n- 通常ボラティリティ市場（2% ≤ ATR ≤ 5%）：標準レバレッジとポジションを使用。\n- 低ボラティリティ市場（ATR < 2%）：レバレッジ×1.15、ポジション×1.05、適度に収益ポテンシャルを向上。\n- ポジションを開く前に市場データのATR指標を確認し、ボラティリティレベルに応じてパラメータを調整。"
            }
        }
    }
}

def update_strategy_file(filepath: Path, strategy_name: str, language: str):
    """更新单个策略文件"""
    print(f"正在处理: {filepath}")
    
    # 读取现有文件
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 获取策略配置
    config = STRATEGIES_CONFIG.get(strategy_name)
    if not config:
        print(f"  ⚠️  未找到策略 {strategy_name} 的配置，跳过")
        return
    
    texts = config["texts"].get(language, config["texts"].get("en", {}))
    
    # 在 entry_prompt 末尾添加波动率调整部分
    if "volatility_section" in texts and "市场波动率" not in data["entry_prompt"] and "Market Volatility" not in data["entry_prompt"] and "市場ボラティリティ" not in data["entry_prompt"]:
        data["entry_prompt"] += texts["volatility_section"]
        print(f"  ✅ 添加了波动率调整部分")
    
    # 在 exit_prompt 末尾添加特定策略的额外逻辑
    if strategy_name == "ultra-short" and "profit_lock" in texts:
        if "盈利锁定" not in data["exit_prompt"] and "Profit Lock" not in data["exit_prompt"] and "利益ロック" not in data["exit_prompt"]:
            data["exit_prompt"] += texts["profit_lock"]
            print(f"  ✅ 添加了盈利锁定机制")
    
    elif strategy_name == "swing-trend":
        if "stop_loss" in texts and "分级止损" not in data["exit_prompt"] and "Tiered Stop-Loss" not in data["exit_prompt"] and "段階的ストップロス" not in data["exit_prompt"]:
            data["exit_prompt"] += texts["stop_loss"]
            print(f"  ✅ 添加了分级止损机制")
        if "trailing_stop" in texts and "分阶段移动" not in data["exit_prompt"] and "Staged Trailing" not in data["exit_prompt"] and "段階的トレーリング" not in data["exit_prompt"]:
            data["exit_prompt"] += texts["trailing_stop"]
            print(f"  ✅ 添加了移动止盈机制")
    
    # 写回文件
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"  ✅ 更新完成")

def main():
    """主函数"""
    strategies_dir = Path(__file__).parent.parent / "src" / "strategies"
    
    if not strategies_dir.exists():
        print(f"❌ 策略目录不存在: {strategies_dir}")
        return
    
    print("=" * 60)
    print("开始迁移策略参数...")
    print("=" * 60)
    
    # 遍历所有策略文件
    for strategy_file in strategies_dir.glob("*.json"):
        # 解析文件名：strategy_language.json
        name_parts = strategy_file.stem.split("_")
        if len(name_parts) >= 2:
            strategy_name = "_".join(name_parts[:-1])
            language = name_parts[-1]
            
            update_strategy_file(strategy_file, strategy_name, language)
        else:
            print(f"  ⚠️  无法解析文件名: {strategy_file.name}，跳过")
    
    print("\n" + "=" * 60)
    print("✅ 所有策略文件已更新！")
    print("=" * 60)

if __name__ == "__main__":
    main()
