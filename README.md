## deploy aws assets with: 
deploy.sh

# deploy to vercel by pushing to git. 

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