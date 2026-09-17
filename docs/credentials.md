# Credentials (all optional, all in `.env`)

Open the `.env` file in the project folder with any text editor and paste each value after the `=`.
Then restart TF2 Scout.

## BPTF_TOKEN — backpack.tf user token
1. Sign in at https://backpack.tf with your Steam account.
2. Go to https://backpack.tf/connections.
3. Under "User Token" click **Show Token** and copy it.

Used for the order book *snapshot* (verifies within seconds that a listing is still alive). Without it, the order book
is built from the live feed only.

## BPTF_API_KEY — backpack.tf API key
1. Go to https://backpack.tf/developer/apikey/view.
2. Create a key: *Site URL* `http://localhost:4400`, *Comments* "personal use, local dashboard".
3. Copy the key.

Used for the daily value of your backpack (Portfolio) and suggested prices.

## STEAM_ID64 — your 17-digit SteamID
At https://steamid.io paste your Steam profile URL and copy the **steamID64** field. It also appears in the URL of your
backpack.tf profile (`backpack.tf/profiles/7656119...`).

## DISCORD_WEBHOOK_URL — alerts on your phone
1. In Discord create your own server (or use one you already have) and a channel, e.g. `#tf2-scout`.
2. Channel settings → **Integrations** → **Webhooks** → **New Webhook** → **Copy Webhook URL**.
3. Paste the URL. Install the Discord app on your phone and enable notifications for that channel.

## STN_API_KEY — optional
https://stntrading.eu/dev/apikey (keys board). Not needed to get started.
