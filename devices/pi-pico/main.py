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

BOOT_WIFI_ATTEMPTS = 2               # quick attempts before falling back to the portal
AP_RETRY_SAVED_MS = 5 * 60 * 1000    # reboot out of the portal to retry saved creds
AP_CLIENT_IDLE_MS = 2 * 60 * 1000    # don't reboot the portal while someone is using it
TAP_DEBOUNCE_MS = 5000

piezo = machine.PWM(machine.Pin(8))
wlan = network.WLAN(network.STA_IF)

wdt = None  # started once device config is loaded; None on unconfigured devices

def feed():
    if wdt:
        wdt.feed()

def sleep_fed(seconds):
    # Sleep without starving the watchdog (RP2040 WDT max is ~8.3s).
    end = time.ticks_add(time.ticks_ms(), int(seconds * 1000))
    while time.ticks_diff(end, time.ticks_ms()) > 0:
        feed()
        time.sleep(0.1)

def buzz_on():
    piezo.freq(800)
    piezo.duty_u16(40000)   # a bit louder than 50%
    time.sleep(0.7)
    piezo.duty_u16(0)

def buzz_error_wifi():
    # Low double-beep for Wi-Fi down.
    piezo.freq(250)
    for _ in range(2):
        piezo.duty_u16(45000)
        time.sleep(0.2)
        piezo.duty_u16(0)
        time.sleep(0.15)

def buzz_error_lambda():
    # Higher triple-beep for Lambda unreachable/error.
    piezo.freq(500)
    for _ in range(3):
        piezo.duty_u16(45000)
        time.sleep(0.12)
        piezo.duty_u16(0)
        time.sleep(0.08)

def post_with_retry(url, payload, headers, retries=1, delay_s=0.5):
    last_exc = None
    for attempt in range(retries + 1):
        try:
            feed()
            r = urequests.post(url, data=payload, headers=headers)
            return r, None
        except Exception as e:
            last_exc = e
            if attempt < retries:
                sleep_fed(delay_s)
    return None, last_exc

def read_wifi_config():
    try:
        with open(WIFI_FILE, "r") as f:
            creds = json.load(f)
            print("Successfuly loaded creds", creds["ssid"])

            return creds["ssid"], creds["password"]
    except (OSError, ValueError, KeyError):
        return None, None

def read_device_config():
    try:
        with open(DEVICE_FILE, "r") as f:
            creds = json.load(f)
            print("Successfuly loaded device creds for ", creds["device_id"])

            return creds["device_id"], creds["lambda_url"], creds["lambda_secret"]
    except (OSError, ValueError, KeyError):
        return None, None, None

def url_decode(s):
    s = s.replace('+', ' ')
    parts = s.split('%')
    result = parts[0]
    for part in parts[1:]:
        try:
            result += chr(int(part[:2], 16)) + part[2:]
        except (ValueError, IndexError):
            result += '%' + part
    return result

def save_wifi_config(ssid, password):
    with open(WIFI_FILE, "w") as f:
        json.dump({"ssid": ssid, "password": password}, f)

def connect_wifi(ssid, password):
    wlan.active(True)
    wlan.connect(ssid, password)

    for _ in range(20):  # wait up to 10 seconds
        feed()
        if wlan.isconnected():
            print("Connected to Wi-Fi:", ssid)
            print("IP:", wlan.ifconfig()[0])
            return True
        time.sleep(0.5)
    print("Failed to connect.")
    return False

def connect_wifi_with_retry(ssid, password, attempts=BOOT_WIFI_ATTEMPTS):
    # A couple of quick attempts, then fall back to the portal. The portal
    # reboots to retry saved creds periodically, so a router that's slow to
    # come back after a power outage still recovers on a later cycle —
    # without making a moved device wait to be reconfigured.
    for attempt in range(attempts):
        if connect_wifi(ssid, password):
            return True
        if attempt < attempts - 1:
            sleep_fed(2)
    return False

def ensure_wifi(ssid, password, failure_times, retry_delay_s=2):
    if wlan.isconnected():
        return True
    print("Wi-Fi disconnected. Reconnecting...")
    if connect_wifi(ssid, password):
        return True
    print("Reconnection failed. Will retry.")
    buzz_error_wifi()
    now = time.time()
    failure_times.append(now)
    failure_times[:] = [t for t in failure_times if now - t <= 60]
    if len(failure_times) >= 3:
        print("Too many Wi-Fi failures. Starting captive portal.")
        return "ap"
    sleep_fed(retry_delay_s)
    return False

def start_ap_mode():
    ap = network.WLAN(network.AP_IF)
    ap.config(essid="tappytrack", password="12345678")
    ap.ifconfig(('192.168.4.1', '255.255.255.0', '192.168.4.1', '8.8.8.8'))  # Set a simple IP address
    ap.active(True)
    print("AP mode started. Connect to:", ap.ifconfig()[0])
    return ap

def init_nfc():
    # Initialize NFC PN532.
    spi = machine.SPI(0,
            baudrate=1000000,
            polarity=0,
            phase=0,
            sck=machine.Pin(6),
            mosi=machine.Pin(3),
            miso=machine.Pin(4))

    cs_pin = machine.Pin(5, machine.Pin.OUT)

    pn532 = nfc.PN532(spi,cs_pin)
    ic, ver, rev, support = pn532.get_firmware_version()
    print('Found PN532 with firmware version: {0}.{1}'.format(ver, rev))

    # Configure PN532 to communicate with MiFare cards.
    pn532.SAM_configuration()
    return pn532

def serve_wifi_form(pn532=None, retry_saved_creds=False):
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
    s.settimeout(0.5)

    started = time.ticks_ms()
    last_client_ms = None
    while True:
        feed()
        if retry_saved_creds and time.ticks_diff(time.ticks_ms(), started) > AP_RETRY_SAVED_MS:
            portal_idle = (last_client_ms is None or
                    time.ticks_diff(time.ticks_ms(), last_client_ms) > AP_CLIENT_IDLE_MS)
            if portal_idle:
                print("No new credentials. Rebooting to retry saved Wi-Fi.")
                reset()
        try:
            cl, addr = s.accept()
        except OSError:
            if pn532:
                uid = pn532.read_passive_target(timeout=1)
                if uid:
                    print("NFC tap while offline. Buzzing error.")
                    buzz_error_wifi()
                    sleep_fed(2)
            continue

        last_client_ms = time.ticks_ms()
        try:
            request = cl.recv(1024).decode()
            print("Request:", request)

            if "ssid=" in request:
                params = request.split(' ', 2)[1].split('?', 1)[-1].split('&')
                param_dict = {kv.split('=')[0]: url_decode(kv.split('=')[1]) for kv in params}
                ssid = param_dict.get("ssid", "")
                password = param_dict.get("password", "")
                if ssid:
                    print("Saving Wi-Fi credentials.")
                    save_wifi_config(ssid, password)
                    cl.send("HTTP/1.1 200 OK\r\n\r\nSaved. Rebooting...")
                    cl.close()
                    sleep_fed(2)
                    reset()

            cl.send(html)
        except Exception as e:
            print("Failed to handle client:", e)
        finally:
            try:
                cl.close()
            except OSError:
                pass

def tap_loop(pn532, ssid, password, device_id, lambda_url, lambda_secret):
    wifi_failure_times = []
    last_uid = None
    last_seen_ms = 0
    print("Waiting for NFC card...")
    while True:
        feed()
        wifi_status = ensure_wifi(ssid, password, wifi_failure_times)
        if wifi_status == "ap":
            start_ap_mode()
            serve_wifi_form(pn532, retry_saved_creds=True)
            return
        if not wifi_status:
            continue

        uid = pn532.read_passive_target(timeout=1)
        if uid is None:
            continue

        uid_str = "".join(["%02X" % b for b in uid])
        now = time.ticks_ms()
        if uid_str == last_uid and time.ticks_diff(now, last_seen_ms) < TAP_DEBOUNCE_MS:
            # Same card still on the reader; keep the debounce window open.
            last_seen_ms = now
            continue
        last_uid = uid_str
        last_seen_ms = now

        print("Card detected! UID:", uid_str)

        buzz_on()

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
            r, err = post_with_retry(lambda_endpoint, payload, headers, retries=1, delay_s=0.5)
            if err:
                print("Request failed after retry:", err)
                buzz_error_lambda()
            else:
                try:
                    print("Response status:", r.status_code)
                    print("Response text:", r.text)
                    if r.status_code < 200 or r.status_code >= 300:
                        print("Lambda error status. Buzzing error.")
                        buzz_error_lambda()
                finally:
                    r.close()
        except Exception as e:
            print("Request failed:", e)
            buzz_error_lambda()

def run():
    global wdt

    device_id, lambda_url, lambda_secret = read_device_config()
    if not (device_id and lambda_url and lambda_secret):
        print("No device configuration found.")
        return

    print("Using device ID:", device_id)

    # Watchdog: reboots the device if anything hangs (e.g. a stalled HTTP
    # request — urequests has no timeout). Not started on unconfigured
    # devices so they stay at the REPL for setup.
    wdt = machine.WDT(timeout=8000)

    ssid, password = read_wifi_config()
    if not (ssid and password):
        print("No credentials. Starting captive portal.")
        start_ap_mode()
        pn532 = init_nfc()
        serve_wifi_form(pn532)
        return

    buzz_on()
    if not connect_wifi_with_retry(ssid, password):
        print("Failed to connect. Starting captive portal.")
        start_ap_mode()
        pn532 = init_nfc()
        serve_wifi_form(pn532, retry_saved_creds=True)
        return

    pn532 = init_nfc()
    tap_loop(pn532, ssid, password, device_id, lambda_url, lambda_secret)

# MAIN LOGIC
try:
    run()
except Exception as e:
    print("Fatal error:", e)
    buzz_error_lambda()
    sleep_fed(3)
    reset()
