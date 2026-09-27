# API Endpoint Specification Template

## 1. Route Metadata
- **HTTP Method**: [GET / POST / PATCH / DELETE]
- **Endpoint Path**: `/api/v1/[resource]`
- **RBAC Scope**: `[resource]:[action]`
- **Rate Limit Tier**: [Default: 60 req/min]

---

## 2. Request Contract
### Headers
- `Authorization`: `Bearer <token>` (Required)
- `Idempotency-Key`: `string` (Required on mutating POST/PATCH)

### Request Body (Zod Schema)
```typescript
export const RequestSchema = z.object({
  // Define fields and validation constraints
});
```

---

## 3. Response Contract
### Success (HTTP 200 / 201)
```json
{
  "success": true,
  "data": {},
  "meta": {
    "request_id": "req_...",
    "timestamp": "..."
  }
}
```

### Error Responses
- `400 Bad Request`: Validation failure.
- `401 Unauthorized`: Invalid or expired JWT.
- `403 Forbidden`: Insufficient role permissions.
- `404 Not Found`: Resource not found within active tenant scope.
- `409 Conflict`: Business invariant conflict.
