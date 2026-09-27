# CommerceOS Bangladesh-First Commerce Domain Guide

> **Status:** Domain reference. Fees and thresholds quoted here are market examples — code reads tenant settings.

## 1. The Realities of Bangladeshi E-commerce & F-Commerce

E-commerce in Bangladesh operates on unique consumer behaviors, linguistic patterns, and logistical realities:
1. **Conversational Checkout**: Over 70% of transactions originate via social messaging (Facebook Messenger, WhatsApp, Instagram DMs) rather than traditional self-service web carts.
2. **Dominance of Cash on Delivery (COD)**: Between 80% to 90% of orders are settled in cash upon physical delivery.
3. **High Return-to-Origin (RTO)**: Customers frequently refuse parcels at the doorstep if delivery takes $> 3$ days or if buyer remorse occurs.
4. **Trilingual Communication**: Customers constantly alternate between standard Bengali (বাংলা), English, and Banglish (Bengali written in English letters).

---

## 2. Natural Language Comprehension (Bangla & Banglish)

CommerceOS agents are engineered to understand natural, informal conversational commerce phrases:

### Common Conversational Patterns
| Customer Message (Banglish / Bangla) | English Meaning | Intent |
| :--- | :--- | :--- |
| *"vai price koto?"* | "Brother, what is the price?" | Price Inquiry |
| *"ভাই এইটার দাম কত?"* | "Brother, what is the price of this?" | Price Inquiry |
| *"XL size available ase?"* | "Is XL size available?" | Stock Check |
| *"ঢাকার ভিতরে delivery charge কত?"* | "How much is delivery charge inside Dhaka?" | Shipping Fee Query |
| *"COD ache?"* / *"COD hobe?"* | "Is Cash on Delivery available?" | Payment Method Query |
| *"kal ke delivery possible?"* | "Is delivery possible tomorrow?" | Expedited ETA Query |
| *"order confirm koren"* | "Please confirm the order." | Checkout Confirmation |
| *"bKash e advance dite hobe?"* | "Do I need to pay advance via bKash?" | Advance Payment Query |

The phonetic normalizer and system prompts map regional spelling variations (e.g. *koto*, *kto*, *koto?*, *দাম কত*) deterministically to catalog and policy tools.

---

## 3. Logistical Realities: Inside vs. Outside Dhaka

Delivery charges and SLAs are universally segmented into two primary zones:
- **Inside Dhaka (ঢাকা মেট্রো)**:
  - Standard rate: 60–80 BDT.
  - Typical delivery time: 24–48 hours.
  - Same-day delivery via Pathao/Steadfast on demand.
- **Outside Dhaka (ঢাকার বাইরে / সাব-আরবান ও সারা বাংলাদেশ)**:
  - Standard rate: 120–150 BDT.
  - Typical delivery time: 3–5 days across 64 districts.
  - Many merchants require a small advance payment (100–200 BDT or delivery charge) via bKash to confirm the order and prevent fake COD orders.

---

## 4. Fraud Prevention & Order Confirmation Pipeline

To slash RTO rates from the industry standard 25% down to under 8%:
1. **Phone Number Sanitization**: Automatically clean and normalize Bangladeshi numbers (e.g. `+88017XXXXXXXX`, `017XXXXXXXX`, `88017XXXXXXXX` $\rightarrow$ `017XXXXXXXX`).
2. **Address Completeness Scoring**: Detect incomplete addresses (e.g. customer just says *"Chittagong"*) and prompt for Road, House, Thana/Upazila, and District before booking courier.
3. **Automated Confirmation Ping**: An interactive WhatsApp/SMS confirmation button must be clicked before dispatching high-value COD parcels.
