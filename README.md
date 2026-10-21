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

## tap deadlines:
- tap processing shares a 4.3-second work budget (Spotify calls at most 2 seconds,
  database calls at most 1 second, no SDK retries); errors return HTTP 504 before
  the tap Lambda's 5-second limit, with 700 ms reserved for error recording and response
- the device allows 6.5 seconds for connection, deferred TLS, request writes,
  and any safe connection retry, then feeds the watchdog and gives the AWS
  response its own 6.5-second deadline; slow TLS setup must not consume AWS's
  response allowance. It closes after the status instead of reading the body
- the 8-second hardware watchdog still recovers native DNS or hardware hangs;
  MicroPython's blocking native DNS lookup cannot be cancelled by this HTTP client
- upload both `main.py` and `tap_http.py` to existing devices for the HTTP deadline;
  no changes to `device.json`, Wi-Fi configuration, or the base firmware are needed
- firmware tests: `python3 -B -m unittest discover -s devices/pi-pico/tests -v`

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
