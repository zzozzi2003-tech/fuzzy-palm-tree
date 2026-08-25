Eleven Store - Discord Product Preview FIX

1) Replace the current GitHub server.js with this server.js.
2) Upload public/assets/discord-preview.png to the SAME path in GitHub.
3) Do not replace your data folder.
4) Deploy latest commit on Render.
5) Test in Discord with a fresh query, e.g.:
   https://eleven-store-sa.onrender.com/product/gang-tablet-system?preview=3

This version preserves the Supabase persistence code and makes /product/:slug always return HTTP 200 with Open Graph metadata for Discord.
