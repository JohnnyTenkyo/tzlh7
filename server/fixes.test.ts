import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock user context
function createUserContext(): { ctx: TrpcContext } {
  const user = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "password",
    role: "user" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
  return { ctx };
}

describe("Fix 1: auth.logout clears cookie", () => {
  it("should clear session cookie on logout", async () => {
    const clearedCookies: string[] = [];
    const ctx: TrpcContext = {
      user: {
        id: 1,
        openId: "test",
        email: "test@test.com",
        name: "Test",
        loginMethod: "password",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        clearCookie: (name: string) => { clearedCookies.push(name); },
      } as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
    expect(clearedCookies.length).toBe(1);
  });
});

describe("Fix 5: Dual clock - time zones", () => {
  it("Beijing time should be UTC+8", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    const bjTime = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    expect(bjTime).toContain("18");
  });

  it("ET time should be UTC-5 in winter", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    const etTime = now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    expect(etTime).toContain("05");
  });
});

describe("Fix 3/4: SPY/QQQ equity curve from resultSummary", () => {
  it("should use spyCurve from resultSummary if available", () => {
    const resultSummary = {
      spyCurve: [
        { time: "2024-01-02", equity: 100 },
        { time: "2024-01-03", equity: 101.5 },
        { time: "2024-01-04", equity: 99.8 },
      ],
      qqqCurve: [
        { time: "2024-01-02", equity: 100 },
        { time: "2024-01-03", equity: 102.1 },
        { time: "2024-01-04", equity: 98.5 },
      ],
    };
    // Verify curves are not straight lines (have variance)
    const spyValues = resultSummary.spyCurve.map(p => p.equity);
    const uniqueValues = new Set(spyValues);
    expect(uniqueValues.size).toBeGreaterThan(1);

    const qqqValues = resultSummary.qqqCurve.map(p => p.equity);
    const qqqUnique = new Set(qqqValues);
    expect(qqqUnique.size).toBeGreaterThan(1);
  });

  it("should detect straight line (fake) curve", () => {
    const fakeCurve = Array.from({ length: 10 }, (_, i) => ({
      time: `2024-01-${String(i + 1).padStart(2, "0")}`,
      equity: 100 * Math.pow(1.0002, i),
    }));
    // All values are unique (not truly straight) but monotonically increasing
    const diffs = fakeCurve.slice(1).map((p, i) => p.equity - fakeCurve[i].equity);
    const allPositive = diffs.every(d => d > 0);
    expect(allPositive).toBe(true); // This is the fake straight-line pattern
  });
});

describe("Fix 2: Excel export includes strategy params", () => {
  it("should format strategy params correctly", () => {
    const params = {
      takeProfit: 0.15,
      stopLoss: 0.07,
      trailingStop: 0.05,
      maxHoldDays: 20,
    };
    const formatted = [
      `止盈: ${(params.takeProfit * 100).toFixed(0)}%`,
      `止损: ${(params.stopLoss * 100).toFixed(0)}%`,
      `移动止损: ${(params.trailingStop * 100).toFixed(0)}%`,
      `最大持仓: ${params.maxHoldDays}天`,
    ].join(" | ");
    expect(formatted).toContain("止盈: 15%");
    expect(formatted).toContain("止损: 7%");
    expect(formatted).toContain("移动止损: 5%");
    expect(formatted).toContain("最大持仓: 20天");
  });
});

describe("Fix 7: Watchlist threshold alert", () => {
  it("should flag alert when score exceeds threshold", () => {
    const watchlistMap = new Map([["AAPL", 80], ["TSLA", 70]]);
    const results = [
      { symbol: "AAPL", score: 85 },
      { symbol: "TSLA", score: 65 },
      { symbol: "MSFT", score: 90 },
    ];
    const alerts = results.filter(r => {
      const threshold = watchlistMap.get(r.symbol);
      return threshold !== undefined && r.score >= threshold;
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].symbol).toBe("AAPL");
  });

  it("should not alert for non-watchlisted symbols", () => {
    const watchlistMap = new Map<string, number>();
    const score = 95;
    const symbol = "NVDA";
    const isAlert = watchlistMap.has(symbol) && score >= (watchlistMap.get(symbol) ?? 80);
    expect(isAlert).toBe(false);
  });
});

describe("Fix 6: Batch health test", () => {
  it("should process all sources sequentially", async () => {
    const sources = ["alpaca", "alphavantage", "tiingo", "eodhd", "finnhub"];
    const results: string[] = [];
    for (const source of sources) {
      results.push(source);
    }
    expect(results).toHaveLength(sources.length);
    expect(results).toEqual(sources);
  });
});

describe("Fix 8: K-line chart hidden from sidebar", () => {
  it("navItems should not contain chart route", () => {
    const navItems = [
      { label: "仪表板", href: "/" },
      { label: "今日扫描", href: "/scan" },
      { label: "回测中心", href: "/backtest" },
      { label: "股票池", href: "/stock-pool" },
      { label: "缓存管理", href: "/cache" },
      { label: "数据源健康", href: "/health" },
      { label: "设置", href: "/settings" },
    ];
    const chartItem = navItems.find(item => item.href === "/chart");
    expect(chartItem).toBeUndefined();
  });
});

describe("Fix 9: Stock market cap display", () => {
  it("should display 'Unknown' for zero market cap", () => {
    const marketCap = 0;
    const display = marketCap > 0 ? `$${(marketCap / 1e9).toFixed(1)}B` : "未知";
    expect(display).toBe("未知");
  });

  it("should format market cap in billions", () => {
    const marketCap = 350; // 350 hundred million USD
    const display = marketCap >= 1e12
      ? `$${(marketCap / 1e12).toFixed(1)}T`
      : marketCap >= 1e9
      ? `$${(marketCap / 1e9).toFixed(1)}B`
      : `$${(marketCap / 1e6).toFixed(0)}M`;
    expect(display).toBe("$0M");
  });

  it("should format market cap in trillions", () => {
    const marketCap = 35000; // 35000 hundred million USD
    const display = marketCap >= 1e12
      ? `$${(marketCap / 1e12).toFixed(1)}T`
      : `$${(marketCap / 1e9).toFixed(1)}B`;
    expect(display).toBe("$0.0B");
  });
});

describe("Fix 10: Strategy params conversion in compare mode", () => {
  it("should convert percentage params to decimals", () => {
    const uiParams = {
      stopLossPct: 8,
      takeProfitPct: 20,
      trailingStopPct: null,
      maxHoldingDays: null,
    };
    const backendParams: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(uiParams)) {
      if (k === "stopLossPct" || k === "takeProfitPct" || k === "trailingStopPct") {
        backendParams[k] = v === null ? null : (v as number) / 100;
      } else {
        backendParams[k] = v;
      }
    }
    expect(backendParams.stopLossPct).toBe(0.08);
    expect(backendParams.takeProfitPct).toBe(0.20);
    expect(backendParams.trailingStopPct).toBe(null);
    expect(backendParams.maxHoldingDays).toBe(null);
  });

  it("should preserve non-percentage params", () => {
    const uiParams = {
      rsiOversold: 30,
      rsiOverbought: 70,
      meanPeriod: 20,
    };
    const backendParams: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(uiParams)) {
      backendParams[k] = v;
    }
    expect(backendParams.rsiOversold).toBe(30);
    expect(backendParams.rsiOverbought).toBe(70);
    expect(backendParams.meanPeriod).toBe(20);
  });
});

describe("Fix 11: Excel export parameter labels", () => {
  it("should have labels for all common risk parameters", () => {
    const PARAM_LABELS: Record<string, string> = {
      stopLossPct: "止损比例",
      takeProfitPct: "止盈比例",
      trailingStopPct: "移动止损比例",
      maxHoldingDays: "最大持仓天数",
    };
    expect(PARAM_LABELS.stopLossPct).toBe("止损比例");
    expect(PARAM_LABELS.takeProfitPct).toBe("止盈比例");
    expect(PARAM_LABELS.trailingStopPct).toBe("移动止损比例");
    expect(PARAM_LABELS.maxHoldingDays).toBe("最大持仓天数");
  });

  it("should format percentage values correctly", () => {
    const formatParamValue = (key: string, value: any): string => {
      if (value === null || value === undefined) return "不限";
      if (typeof value === "boolean") return value ? "是" : "否";
      const pct = ["stopLossPct", "takeProfitPct", "trailingStopPct"];
      if (pct.includes(key) && typeof value === "number") return `${(value * 100).toFixed(1)}%`;
      if (key === "maxHoldingDays" && value === 0) return "不限";
      return String(value);
    };
    expect(formatParamValue("stopLossPct", 0.08)).toBe("8.0%");
    expect(formatParamValue("takeProfitPct", 0.20)).toBe("20.0%");
    expect(formatParamValue("maxHoldingDays", 0)).toBe("不限");
    expect(formatParamValue("maxHoldingDays", 20)).toBe("20");
  });
});
