---
description: Add a courier, payment, messaging, or enterprise provider adapter with webhook verification and mocks
---

# Integration & Provider Adapter Development Workflow

Follow this procedure when implementing a new third-party courier, payment gateway, or messaging channel adapter in CommerceOS:

1. **Review Domain Interface**:
   - Inspect existing adapters: social channels in `src/domains/social/channels/adapters/*.adapter.ts`; couriers in `src/domains/shipping/` and `src/domains/automation/services/courier-sync.service.ts`; payments in `src/domains/payments/`; enterprise in `src/domains/enterprise/services/*-adapter.service.ts`.
   - If the new provider requires new capabilities, update the interface and all existing adapters consistently.

2. **Implement Provider Adapter**:
   - Create the provider next to its siblings (e.g. `src/domains/social/channels/adapters/<provider>.adapter.ts`).
   - Implement authentication, token refresh, and request formatting.
   - Encapsulate vendor-specific error codes into standard `AppError` instances (`src/lib/errors.ts`).
   - Until real credentials and calls exist, the adapter returns `SIMULATED` / `NOT_SENT` — never a success status (`rules/truthfulness.md`).

3. **Implement Webhook Verification Handler**:
   - Create signature validation function using HMAC or RSA public keys.
   - Include timestamp freshness and replay attack checks.

4. **Build Mock Adapter for Automated Testing**:
   - Create deterministic test mock returning realistic vendor responses.
   - Write integration tests verifying behavior under success, timeout, and authentication error conditions.

5. **Register in Integration Manager & Settings UI**:
   - Add provider configuration keys to tenant settings schema.
   - Expose credentials configuration in the Settings / Integrations Bento view.
