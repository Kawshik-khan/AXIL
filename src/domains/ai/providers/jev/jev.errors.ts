/**
 * CommerceOS Phase 4: Jev System One Typed Error Classes
 * Inherits from base AppError per CODING_STANDARDS.md.
 */

import { AppError } from "@/lib/errors";

export class JevClientError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("JEV_CLIENT_ERROR", message, 502, details);
  }
}

export class JevCircuitBreakerOpenError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super(
      "JEV_CIRCUIT_BREAKER_OPEN",
      "Jev System One provider circuit breaker is OPEN due to consecutive failures. Request redirected to fallback.",
      503,
      details
    );
  }
}

export class JevValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("JEV_VALIDATION_ERROR", message, 422, details);
  }
}
