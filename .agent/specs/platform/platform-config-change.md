# Workflow: Platform Configuration Modification

Follow this 10-step sequence when modifying any platform setting, AI gateway route, or global parameter:

```
[ Step 1: Read Current Setting Record & Version ]
               │
               ▼
[ Step 2: Validate Target Value against Strict Zod Schema ]
               │
               ▼
[ Step 3: Determine Risk Tier of Target Setting (MEDIUM / CRITICAL) ]
               │
               ▼
[ Step 4: Verify Platform Authorization ('platform.manage') ]
               │
               ▼
[ Step 5: Enforce Step-Up Verification (Required if marked is_sensitive) ]
               │
               ▼
[ Step 6: Dual Approval Gate (Required if CRITICAL tier) ]
               │
               ▼
[ Step 7: Apply Configuration Update & Create Version Record ]
               │
               ▼
[ Step 8: Verify Application Invariant & Hot-Reload Listeners ]
               │
               ▼
[ Step 9: Write Immutable Platform Audit Log (Diff Snapshot) ]
               │
               ▼
[ Step 10: Emit 'platform.setting.updated' to Distributed Redis Bus ]
```

---

## Inviolable Rules
1. **Zero Arbitrary JSON Blobs**:
   - **NEVER** accept unvalidated key-value pairs or arbitrary configuration JSON.
   - Every setting key must possess a strongly typed Zod schema defining valid types, ranges, and allowed enum values.
2. **Versioned History Mandatory**:
   - Updating `platform_settings` must insert a corresponding row into `platform_setting_versions` capturing the previous value, new value, operator ID, and change reason.
3. **Hot-Reload Notification**:
   - When a platform setting updates, the service publishes an event to Redis channel `platform:settings:updated` so running worker nodes can hot-reload without downtime.
