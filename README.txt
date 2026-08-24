ELEVEN STORE v6.2.1 — ADMIN AUTH FIX

FIXED
- Fixed Unauthorized errors when editing, hiding, deleting or adding products in Admin.
- Admin login now uses both the normal secure session and a short-lived signed admin token.
- The admin token is kept only in sessionStorage for the current browser tab/session.
- All Admin API requests send credentials explicitly.
- Login now waits for the server session to save before opening the dashboard.
- Existing CSRF protection remains for cookie-session requests.

UPLOAD TO GITHUB
- server.js
- public/admin.js
- package.json

After Render deploys, log out and log back in to Admin once.
