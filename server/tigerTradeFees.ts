/**
 * Tiger Trade Fee Calculator
 * Simulates Tiger Brokers commission structure
 */

export interface TradeFeesResult {
  commissionFee: number;  // broker commission
  commission: number;     // alias for commissionFee
  platformFee: number;    // platform/regulatory fee
  totalFee: number;       // total fees
}

/**
 * Calculate Tiger Brokers trade fees
 * - Commission: $0.005/share, min $1, max 0.5% of trade value
 * - Platform fee: $0.003/share, min $0.3
 * - SEC fee (sell only): $0.0000278 * trade value
 */
export function calculateTradeFees(
  quantity: number,
  price: number,
  side: "buy" | "sell" = "buy"
): TradeFeesResult {
  const tradeValue = quantity * price;

  // Commission fee: $0.005/share, min $1, max 0.5% of trade value
  const rawCommission = quantity * 0.005;
  const commissionFee = Math.min(Math.max(rawCommission, 1), tradeValue * 0.005);

  // Platform fee: $0.003/share, min $0.3
  const platformFee = Math.max(quantity * 0.003, 0.3);

  // SEC fee (sell only)
  const secFee = side === "sell" ? tradeValue * 0.0000278 : 0;

  const totalFee = commissionFee + platformFee + secFee;

  const roundedCommission = Math.round(commissionFee * 100) / 100;
  const roundedPlatform = Math.round((platformFee + secFee) * 100) / 100;
  return {
    commissionFee: roundedCommission,
    commission: roundedCommission,
    platformFee: roundedPlatform,
    totalFee: Math.round(totalFee * 100) / 100,
  };
}
