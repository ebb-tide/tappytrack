# this is the contents of the run.py file when the device was directly comms'ing with spotify
#!/usr/bin/env python3


# needs source nfc/bin/activate

import time
import board
import busio
from digitalio import DigitalInOut
from adafruit_pn532.spi import PN532_SPI
import socket
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv
import os

load_dotenv("/home/pi/nfc/.env")

os.getenv("SPOTIPY_CLIENT_ID")
os.getenv("SPOTIPY_CLIENT_SECRET")
os.getenv("SPOTIPY_REDIRECT_URI")
os.getenv("SPOTIPY_SCOPE")

time.sleep(10)
def wait_for_internet(host="8.8.8.8", port=53, timeout=3):
    """Try to connect to a DNS server to confirm internet access"""
    while True:
        try:
            socket.setdefaulttimeout(timeout)
            socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect((host, port))
            print("Internet connection established.")
            break
        except Exception as ex:
            print(f"No internet connection. Retrying in 5 seconds... ({ex})")
            time.sleep(5)

# Wait for internet before doing anything else
wait_for_internet()

# Now start the real work
print("Starting main script...")

sp= spotipy.Spotify(auth_manager=SpotifyOAuth(scope="user-modify-playback-state user-read-playback-state user-read-currently-playing"))
devices= sp.devices()
print("Connected to spotify")


# SPI connection:
spi = busio.SPI(board.SCK, board.MOSI, board.MISO)
cs_pin = DigitalInOut(board.D5)
pn532 = PN532_SPI(spi, cs_pin, debug=False)

# Configure PN532 to communicate with NFC cards
pn532.SAM_configuration()

print('Waiting for RFID/NFC card...')

lookup= {
        "922506ff":"spotify:track:36o6iGxPTK7y7mF5v06ZXZ",       # baby beluga, big card 
        "04f0875d6f6180":"spotify:track:1rNgLcVhVTTKKmHBH8nQlt", # 5 monkeys, labeled #5
        "04d38e576f6181":"spotify:track:4oEVDEWT1NhOY1eroalRWq", # labeled crown walking in the jungle
        "04f9685b6f6180":"spotify:track:5ygDXis42ncn6kYG14lEVG", # baby shark, labeled #7
        "04d68f5c6f6180":"spotify:track:1IoEITHkdiep6Slg3Hti0h", # wheels on the bus, labeled with a stick figure
        "04522b586f6180":"spotify:track:2Qu65QrO1DiWVJIteOD9ri", # twinkle twinkle little star, labeled calm 
        "041c846d5f6181":"spotify:track:4jKlouPlVZOkuRwyBpgLPN", # one little finger labeled #1
        "0491e3586f6180":"spotify:track:68oEtRynOZG9E3yeTBWu3k"  # mr sun, labeled 2
        }

while True:
    # Check if a card is available to read
    uid = pn532.read_passive_target(timeout=0.5)
    # Try again if no card is available.
    if uid is None:
        continue
    uid_string= uid.hex()
    print('Found card with UID:', uid_string)
    uri=lookup.get(uid_string)
    if uri:
        sp.start_playback(device_id="b56563eb59b75f05e70806696cec641440eb2bb1", uris=[uri])
    while pn532.read_passive_target(timeout=0.5):
        time.sleep(0.1)

