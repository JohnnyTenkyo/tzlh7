import { describe, it, expect } from "vitest";

describe("Excel Export Parameter Formatting", () => {
  const PARAM_LABELS: Record<string, string> = {
    stopLossPct: "止损比例",
    takeProfitPct: "止盈比例",
    trailingStopPct: "移动止损比例",
    maxHoldingDays: "最大持仓天数",
    rsiPeriod: "RSI周期",
    rsiReversal: "RSI反转阈值",
    bbMultiplier: "布林带倍数",
    bbPeriod: "布林带周期",
  };

  const formatParamValue = (key: string, value: any): string => {
    if (value === null || value === undefined) return "不限";
    if (typeof value === "boolean") return value ? "是" : "否";
    const pct = ["stopLossPct", "takeProfitPct", "trailingStopPct"];
    if (pct.includes(key) && typeof value === "number") return `${(value * 100).toFixed(1)}%`;
    if (key === "maxHoldingDays" && value === 0) return "不限";
    if (typeof value === "object") {
      if (Array.isArray(value)) return value.join(", ");
      try {
        const lines: string[] = [];
        for (const [k, v] of Object.entries(value)) {
          const label = PARAM_LABELS[k] || k;
          const formattedVal = formatParamValue(k, v);
          lines.push(`${label}: ${formattedVal}`);
        }
        return lines.join("; ");
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  describe("Common Parameters", () => {
    it("should format stopLossPct as percentage", () => {
      expect(formatParamValue("stopLossPct", 0.05)).toBe("5.0%");
    });

    it("should format takeProfitPct as percentage", () => {
      expect(formatParamValue("takeProfitPct", 0.03)).toBe("3.0%");
    });

    it("should format trailingStopPct as percentage", () => {
      expect(formatParamValue("trailingStopPct", 0.02)).toBe("2.0%");
    });

    it("should format maxHoldingDays as number", () => {
      expect(formatParamValue("maxHoldingDays", 95)).toBe("95");
    });

    it("should format maxHoldingDays=0 as 不限", () => {
      expect(formatParamValue("maxHoldingDays", 0)).toBe("不限");
    });

    it("should format null as 不限", () => {
      expect(formatParamValue("stopLossPct", null)).toBe("不限");
    });
  });

  describe("Strategy Parameters", () => {
    it("should format object parameters with Chinese labels", () => {
      const params = {
        maxHoldingDays: 95,
        stopLossPct: 0.06,
        takeProfitPct: 3.0,
      };

      const result = formatParamValue("aggressive", params);
      expect(result).toContain("最大持仓天数");
      expect(result).toContain("95");
      expect(result).toContain("止损比例");
      expect(result).toContain("6.0%");
      expect(result).toContain("止盈比例");
      expect(result).toContain("300.0%");
    });

    it("should format rsi_reversal params", () => {
      const params = {
        rsiPeriod: 14,
        rsiReversal: 30,
      };

      const result = formatParamValue("rsi_reversal", params);
      expect(result).toContain("RSI周期");
      expect(result).toContain("14");
      expect(result).toContain("RSI反转阈值");
      expect(result).toContain("30");
    });
  });

  describe("Label Mapping", () => {
    it("should have Chinese labels for common parameters", () => {
      expect(PARAM_LABELS["stopLossPct"]).toBe("止损比例");
      expect(PARAM_LABELS["takeProfitPct"]).toBe("止盈比例");
      expect(PARAM_LABELS["trailingStopPct"]).toBe("移动止损比例");
      expect(PARAM_LABELS["maxHoldingDays"]).toBe("最大持仓天数");
    });
  });
});
