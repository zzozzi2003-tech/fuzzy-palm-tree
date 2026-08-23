ELEVEN STORE v5.4.2 — RECEIPT UPLOAD FIX

Fixes:
- Receipt upload now uses memory upload first, then saves explicitly.
- Better JSON errors for invalid file types and files over 8 MB.
- Every receipt request writes a [BANK TRANSFER] line to Render Logs.
- Successful uploads write [PAYMENT RECEIPT] to Render Logs.
- Server startup now prints "Eleven Store v5.4.2 running".
- Admin Payment Logs remain available.

After upload to GitHub and Render deploy, verify the Render log contains:
Eleven Store v5.4.2 running

Then upload a receipt and look for:
[BANK TRANSFER] request received
[PAYMENT RECEIPT] ES-xxxxx ...
