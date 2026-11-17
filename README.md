# WYRIX — Netlify Discord OAuth

This project is a minimal English-language WYRIX interface with Discord OAuth and server-side owner verification. Store and owner admin functions are not yet implemented.

## Deploy

Connect this GitHub repository to the existing Netlify site. Set publish directory to repository root and functions directory to netlify/functions. Add environment variables DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET (random, 64+ characters), and DISCORD_REDIRECT_URI=https://startling-hummingbird-797153.netlify.app/.netlify/functions/discord-callback. Set secrets in Netlify UI, not GitHub.

Register the exact redirect URI in Discord Developer Portal. After redeploy, test /.netlify/functions/auth-session, then sign in from the site. Owner Discord ID: 1282787310672285738.

The client secret previously shared in chat must be rotated. Do not publish it. All future admin APIs must call server-side authorization, not rely on a visible Owner page.
