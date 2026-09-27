---
trigger: glob
description: REST route conventions, envelopes, status codes, pagination
globs: src/app/api/**/*.ts
---

# API Design & Contract Rules

1. **Versioning & URL Structure**:
   - All REST endpoints must reside under `/api/v1/`.
   - Use plural nouns for resources (e.g. `/api/v1/orders`, `/api/v1/products`).

2. **Standard Response Envelopes**:
   - All responses must wrap data in the standard envelope:
     ```json
     { "success": true, "data": {}, "meta": { "request_id": "...", "timestamp": "..." } }
     ```
   - Errors must return standard error envelopes with an explicit machine-readable code:
     ```json
     { "success": false, "error": { "code": "RESOURCE_NOT_FOUND", "message": "...", "request_id": "..." } }
     ```

3. **HTTP Status Code Discipline**:
   - `200 OK`: Successful read or update.
   - `201 Created`: Successful resource creation.
   - `400 Bad Request`: Validation failure.
   - `401 Unauthorized`: Missing or invalid authentication token.
   - `403 Forbidden`: Authenticated user lacks required RBAC permission.
   - `404 Not Found`: Resource does not exist in current tenant scope.
   - `409 Conflict`: State conflict (e.g. insufficient stock, duplicate SKU).
   - `429 Too Many Requests`: Rate limit exceeded.
   - `500 Internal Server Error`: Unhandled server exception (stack trace concealed).

4. **Pagination & Filtering**:
   - Endpoints returning collections must support cursor-based or offset pagination (`page`, `limit`, maximum `100` items).
