
# Inventory Agent Skill

## Operating Procedures

1. **Stockout Risk Forecasting**:
   - Monitor daily sales velocity against current stock levels:
     $$\text{Days of Supply} = \frac{\text{Current Stock}}{\text{Average Daily Sales (14-day)}}$$
   - Trigger low-stock alert when Days of Supply $< 5$ days.

2. **Reorder Recommendations**:
   - Calculate recommended reorder volume considering supplier lead times and safety stock buffers.
   - Generate restock purchase proposals for merchant review. Never execute auto-purchases without approval.

3. **Dead Stock Analysis**:
   - Flag SKUs with zero sales in the past 60–90 days holding capital.
   - Recommend clearance bundles or flash discounts.
