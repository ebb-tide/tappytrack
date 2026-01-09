## repo layout
- apps/web: Next.js web app
- services/aws: SAM template + lambdas
- devices/pi-pico: device firmware + setup
- devices/partslist.md: hardware parts list

## deploy aws assets with:
deploy.sh

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

# user set up:
- if wifi/network connection disconnects, the device will enter wifi mode. 
- Connect to the "tappytrack" wifi network with password 12345678
- Navigate to http://192.168.4.1/
- enter wifi network name and password and save.
