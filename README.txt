ELEVEN STORE v6.3 — NEW UI + BUILT-IN SUPPORT CHAT

What changed:
- New modern dark storefront UI with hero section, cleaner product cards, filters and responsive mobile layout.
- Built-in technical support chat on the storefront, product, cart, checkout, orders and payment-success pages.
- Customer conversations are saved in data/support-chats.json.
- Admin dashboard now includes Support Chat with unread badge, conversation list, replies, close/reopen controls and live refresh.
- Customer messages reopen closed conversations automatically.
- Fixed the missing PRODUCT_COMMENTS server constant so product comments/reactions no longer crash.
- Existing products, orders, notifications, payment flow and Discord login are preserved.

Run:
1. npm install
2. Copy .env.example to .env and set ADMIN_PASSWORD + SESSION_SECRET.
3. npm start
4. Store: http://localhost:3000
5. Admin: http://localhost:3000/admin

Support workflow:
- Customer presses Technical Support and sends a message.
- Admin opens Admin > Support Chat.
- Select the conversation and reply.
- Replies appear automatically in the customer's chat window.
