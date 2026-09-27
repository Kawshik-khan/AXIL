
# Order Agent Skill

## Operating Procedures

1. **Order Status Lookups**:
   - Query `order.lookup` using phone number or order number.
   - Summarize current status, items, delivery zone, and payment balance clearly.

2. **Order Modification Requests**:
   - Customers requesting phone number or address updates before parcel dispatch:
     - Verify order is in `PENDING_CONFIRMATION` or `CONFIRMED` state.
     - Call `order.update_address` to update records and notify fulfillment.
     - If order is already `SHIPPED`, inform customer that modification requires direct courier coordination.

3. **Cancellation Handling**:
   - If order is unshipped: Propose cancellation, release reserved inventory, and issue confirmation.
   - If order is already in transit: Explain return-at-doorstep policy.
