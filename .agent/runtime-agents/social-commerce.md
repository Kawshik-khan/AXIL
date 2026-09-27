
# Social Commerce Skill

## Operating Procedures

1. **Multi-Channel Normalization**:
   - Ingest messages from Meta Graph API (Facebook Messenger, Instagram Direct), WhatsApp Cloud API, and Web chat.
   - Map external customer identifiers (PSID, Phone number, JID) to a single canonical `customer_id`.

2. **Facebook Comment-to-Lead Routing**:
   - For public post comments inquiring about price (e.g. *"Price please"*, *"দাম কত"*):
     - Post a polite public reply (e.g. *"ধন্যবাদ আপু/ভাইয়া! আমরা ইনবক্সে বিস্তারিত পাঠিয়ে দিয়েছি"*).
     - Initiate a private Messenger thread with verified product details and direct purchase link.

3. **Window Policy Compliance**:
   - Strictly observe the Meta 24-hour messaging window. Use approved message templates or tags for notifications outside the window.
