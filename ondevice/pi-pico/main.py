import network
import socket
import time
import json
import os
import machine
import NFC_PN532 as nfc
from machine import reset
import urequests

WIFI_FILE = "wifi.json"
DEVICE_FILE = "device.json"

piezo = machine.PWM(machine.Pin(15))

def buzz_on():
    piezo.freq(800)
    piezo.duty_u16(40000)   # a bit louder than 50%
    time.sleep(0.7)
    piezo.duty_u16(0)


def read_wifi_config():
    try:
        with open(WIFI_FILE, "r") as f:
            creds = json.load(f)
            print("Successfuly loaded creds", creds["ssid"])

            return creds["ssid"], creds["password"]
    except:
        return None, None

def read_device_config():
    try:
        with open(DEVICE_FILE, "r") as f:
            creds = json.load(f)
            print("Successfuly loaded device creds for ", creds["device_id"])

            return creds["device_id"], creds["lambda_url"], creds["lambda_secret"]
    except:
        return None, None, None

def save_wifi_config(ssid, password):
    with open(WIFI_FILE, "w") as f:
        json.dump({"ssid": ssid, "password": password}, f)

def connect_wifi(ssid, password):
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(ssid, password)

    for _ in range(20):  # wait up to 10 seconds
        if wlan.isconnected():
            print("Connected to Wi-Fi:", ssid)
            print("IP:", wlan.ifconfig()[0])
            return True
        time.sleep(0.5)
    print("Failed to connect.")
    return False

def start_ap_mode():
    ap = network.WLAN(network.AP_IF)
    ap.config(essid="tappytrack", password="12345678")
    ap.ifconfig(('192.168.4.1', '255.255.255.0', '192.168.4.1', '8.8.8.8'))  # Set a simple IP address
    ap.active(True)
    print("AP mode started. Connect to:", ap.ifconfig()[0])
    return ap

def serve_wifi_form():
    html = """\
HTTP/1.1 200 OK

<!DOCTYPE html>
<html>
  <body>
    <h2>Wi-Fi Setup</h2>
    <form action="/" method="get">
      SSID: <input name="ssid"><br>
      Password: <input name="password" type="password"><br>
      <input type="submit" value="Save and Connect">
    </form>
  </body>
</html>
"""

    addr = socket.getaddrinfo('0.0.0.0', 80)[0][-1]
    s = socket.socket()
    s.bind(addr)
    s.listen(1)

    while True:
        cl, addr = s.accept()
        request = cl.recv(1024).decode()
        print("Request:", request)

        if "ssid=" in request:
            try:
                params = request.split(' ', 2)[1].split('?', 1)[-1].split('&')
                param_dict = {kv.split('=')[0]: kv.split('=')[1].replace('%20', ' ') for kv in params}
                ssid = param_dict.get("ssid", "")
                password = param_dict.get("password", "")
                print("Saving Wi-Fi credentials.")
                save_wifi_config(ssid, password)
                cl.send("HTTP/1.1 200 OK\r\n\r\nSaved. Rebooting...")
                cl.close()
                time.sleep(2)
                reset()
                return
            except Exception as e:
                print("Failed to parse:", e)

        cl.send(html)
        cl.close()

device_id, lambda_url, lambda_secret = read_device_config()

if device_id and lambda_url and lambda_secret:
    print("Using device ID:", device_id)

    ssid, password = read_wifi_config()

    if ssid and password:
        buzz_on();
        if connect_wifi(ssid, password):

            # Initialize NFC PN532
            spi = machine.SPI(0,
                    baudrate=1000000,
                    polarity=0,
                    phase=0,
                    sck=machine.Pin(2),
                    mosi=machine.Pin(3),
                    miso=machine.Pin(0))

            cs_pin = machine.Pin(1, machine.Pin.OUT)

            pn532 = nfc.PN532(spi,cs_pin)
            ic, ver, rev, support = pn532.get_firmware_version()
            print('Found PN532 with firmware version: {0}.{1}'.format(ver, rev))

            # Configure PN532 to communicate with MiFare cards
            pn532.SAM_configuration()

            while True:
                print("Waiting for NFC card...")
                uid = pn532.read_passive_target(timeout=1)
                if uid is None:
                    continue

                uid_str = "".join(["%02X" % b for b in uid])
                print("Card detected! UID:", uid_str)
                
                buzz_on();

                try:
                    payload = json.dumps({
                        "deviceid": device_id,
                        "cardID": uid_str
                    })
                    headers = {
                        "Content-Type": "application/json",
                        "x-internal": lambda_secret
                    }
                    lambda_endpoint = lambda_url + "/tap"
                    r = urequests.post(lambda_endpoint, data=payload, headers=headers)
                    print("Response status:", r.status_code)
                    print("Response text:", r.text)
                    r.close()
                except Exception as e:
                    print("Request failed:", e)

                time.sleep(5)
                
        else:
            print("Failed to connect. Starting captive portal.")
            start_ap_mode()
            serve_wifi_form()
    else:
        print("No credentials. Starting captive portal.")
        start_ap_mode()
        serve_wifi_form()

else :
    print("No device configuration found.")
# MAIN LOGIC

