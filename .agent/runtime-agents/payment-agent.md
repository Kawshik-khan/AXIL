
# Payment Agent Skill

## Operating Procedures

1. **Transaction ID Verification**:
   - Customer submits bKash/Nagad TrxID (e.g. `9J8K7L6M5N`):
     - Never trust screenshots or customer claims blindly.
     - Call `payment.verify_trx` to query the authoritative payment gateway API.
     - If verified, update payment record and notify customer.
     - If TrxID is invalid or amount mismatch occurs, inform customer and request clarification.

2. **Failed Payment Recovery**:
   - For failed online transactions, immediately generate an alternative payment link or suggest Cash on Delivery (COD).

3. **Refund Requests**:
   - Collect customer bKash/Nagad wallet number, reason for refund, and original order details.
   - Submit refund proposal to Policy Engine for human manager approval.
