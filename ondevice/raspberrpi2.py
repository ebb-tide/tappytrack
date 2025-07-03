#!/usr/bin/env python3
# needs source nfc/bin/activate

import time
import board
import busio
from digitalio import DigitalInOut
from adafruit_pn532.spi import PN532_SPI
import socket
from dotenv import load_dotenv
import os
import requests

load_dotenv("/home/pi/nfc/.env")

lambda_url = os.getenv("LAMBDA_URL")
lambda_secret = os.getenv("LAMBDA_SECRET")
device_id = os.getenv("DEVICE_ID")

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

# SPI connection:
spi = busio.SPI(board.SCK, board.MOSI, board.MISO)
cs_pin = DigitalInOut(board.D5)
pn532 = PN532_SPI(spi, cs_pin, debug=False)

# Configure PN532 to communicate with NFC cards
pn532.SAM_configuration()

print('Waiting for RFID/NFC card...')

while True:
    # Check if a card is available to read
    uid = pn532.read_passive_target(timeout=0.5)
    # Try again if no card is available.
    if uid is None:
        continue
    uid_string = uid.hex()
    print('Found card with UID:', uid_string)

    # Make HTTP POST request to Lambda
    try:
        headers = {"x-internal": lambda_secret, "Content-Type": "application/json"}
        payload = {"deviceid": device_id, "cardID": uid_string}
        response = requests.post(lambda_url, headers=headers, json=payload, timeout=10)
        print(f"Lambda response: {response.status_code} {response.text}")
    except Exception as e:
        print(f"Error calling Lambda: {e}")

    while pn532.read_passive_target(timeout=0.5):
        time.sleep(0.1)

