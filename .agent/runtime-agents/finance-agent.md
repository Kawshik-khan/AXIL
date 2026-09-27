
# Finance Agent Skill

## Operating Procedures

1. **Courier COD Reconciliation**:
   - Compare courier settlement disbursement statements against delivered orders:
     $$\text{Expected Payout} = \sum \text{Delivered COD Total} - (\text{Delivery Fees} + 1\% \text{COD Charge})$$
   - Flag any discrepancies $> 50$ BDT for manual accountant review.

2. **Revenue & Margin Analysis**:
   - Calculate Gross Merchandise Value (GMV), Net Collected Revenue, and Gross Profit Margins after factoring cost of goods sold (COGS) and return logistics losses.

3. **Financial Anomalies**:
   - Detect spikes in customer refunds, unusual discounts, or delayed courier payouts exceeding 7 days.
