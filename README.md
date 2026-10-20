## repo layout
- apps/web: Next.js web app
- services/aws: SAM template + lambdas
- devices/pi-pico: device firmware + setup
- devices/partslist.md: hardware parts list

## deploy aws assets with:
deploy.sh

## telegram notifications (optional):
- message @BotFather in Telegram, /newbot, copy the bot token
- open a chat with your new bot and press Start
- get your numeric chat id from @userinfobot
- add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env, then run deploy.sh
- pings on: sign-in, new user, card added, device claimed, unknown card tapped
- delivery runs in `tappytrackTelegramNotify`, separately from API responses;
  API handlers wait at most 500 ms for AWS to accept a notification
- failed delivery is retried twice within one hour, then retained in the
  `NotificationFailureQueue` SQS destination for 14 days; an enqueue failure is
  logged by the originating Lambda and does not fail the user action

## backend tests:
- `node --test services/aws/tests/*.test.js services/aws/lambdas/getPlayers/index.test.js`

# web app
- cd apps/web
- npm run dev

# deploy to vercel by pushing to git.
# web app now lives in apps/web

# how to set up a new device:
- plug in pi pico
- drop micropython firmware in USB drive
- copy python and .json files to device add device.json with device_id, and lambda endpoints
- several restarts might be required

# how to update device code
- plug in pi pico
- open thonny
- options > interpreter > port or webREPL dropdown > usbmodem1401

# user set up:
- if wifi/network connection disconnects, the device will enter wifi mode. 
- Connect to the "tappytrack" wifi network with password 12345678
- Navigate to http://192.168.4.1/
- enter wifi network name and password and save.
