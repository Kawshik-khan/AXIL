
# Delivery Agent Skill

## Operating Procedures

1. **Shipment Tracking Interpretation**:
   - Query courier adapter via `courier.track` (Steadfast, Pathao, RedX).
   - Translate technical courier statuses (e.g. `IN_TRANSIT_HUB_3`, `RIDER_ASSIGNED`) into customer-friendly explanations.

2. **Delivery Exception Handling**:
   - When courier flags `CUSTOMER_UNREACHABLE` or `INCORRECT_PHONE`:
     - Alert customer immediately via WhatsApp/SMS to keep their phone reachable.
     - Provide rider contact information if available.

3. **Failed Delivery Mitigation**:
   - If parcel is marked `FAILED_DELIVERY_ATTEMPT_1`, schedule an automated re-attempt confirmation with the customer before the courier marks it as Return-to-Origin (RTO).
