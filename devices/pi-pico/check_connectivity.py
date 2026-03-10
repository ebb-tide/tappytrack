"""
Hardware connectivity checker for TappyTrack Pi Pico.
Tests piezo buzzer and NFC module wiring with detailed NFC diagnostics.
Upload and run via Thonny or mpremote.
"""

import time
import machine
import NFC_PN532 as nfc


def check_piezo():
    print("\n--- Piezo Buzzer (GPIO 8) ---")
    try:
        piezo = machine.PWM(machine.Pin(8))
        piezo.freq(800)
        piezo.duty_u16(40000)
        time.sleep(0.3)
        piezo.duty_u16(0)
        piezo.deinit()
        print("  PWM initialized OK — you should have heard a beep")
        return True
    except Exception as e:
        print("  FAILED:", e)
        return False


def check_nfc():
    print("\n--- NFC PN532 (SPI0: SCK=6, MOSI=3, MISO=4, CS=5) ---")

    # Step 1: SPI bus init
    print("\n  [1/5] SPI bus init...")
    try:
        spi = machine.SPI(0,
                baudrate=1000000,
                polarity=0,
                phase=0,
                sck=machine.Pin(6),
                mosi=machine.Pin(3),
                miso=machine.Pin(4))
        cs_pin = machine.Pin(5, machine.Pin.OUT)
        print("    OK")
    except Exception as e:
        print("    FAILED:", e)
        print("    -> Check SCK (GP6), MOSI (GP3), MISO (GP4) wiring")
        return False

    # Step 2: CS pin toggle
    print("\n  [2/5] CS pin toggle...")
    try:
        cs_pin.on()
        time.sleep(0.01)
        cs_pin.off()
        time.sleep(0.01)
        cs_pin.on()
        print("    OK")
    except Exception as e:
        print("    FAILED:", e)
        print("    -> Check CS (GP5) wiring")
        return False

    # Step 3: Raw SPI read (check MISO line)
    print("\n  [3/5] Raw SPI read...")
    try:
        cs_pin.off()
        time.sleep_ms(2)
        buf = bytearray(4)
        spi.readinto(buf)
        time.sleep_ms(2)
        cs_pin.on()
        all_ff = all(b == 0xFF for b in buf)
        all_00 = all(b == 0x00 for b in buf)
        print("    Raw bytes:", [hex(b) for b in buf])
        if all_ff:
            print("    WARNING: All 0xFF — MISO may be floating (not connected)")
        elif all_00:
            print("    WARNING: All 0x00 — MISO may be stuck low")
        else:
            print("    OK — MISO line responding")
    except Exception as e:
        print("    FAILED:", e)

    # Step 4: PN532 wakeup + firmware version
    print("\n  [4/5] PN532 wakeup + firmware version...")
    try:
        pn532 = nfc.PN532(spi, cs_pin)
        ic, ver, rev, support = pn532.get_firmware_version()
        print("    Firmware: {}.{}".format(ver, rev))
        print("    OK")
    except RuntimeError as e:
        print("    FAILED:", e)
        print("    Possible causes:")
        print("      - PN532 mode switch not set to SPI (check DIP switches)")
        print("      - VCC not connected to 3V3")
        print("      - GND not connected")
        print("      - MOSI/MISO swapped")
        print("      - Loose jumper wires")
        return False
    except Exception as e:
        print("    FAILED:", e)
        return False

    # Step 5: SAM config + card read
    print("\n  [5/5] SAM configuration + card read test...")
    try:
        pn532.SAM_configuration()
        print("    SAM configured OK")
        print("    Tap a card to test read (5s timeout)...")
        uid = pn532.read_passive_target(timeout=5)
        if uid:
            uid_str = "".join(["%02X" % b for b in uid])
            print("    Card detected! UID:", uid_str)
        else:
            print("    No card tapped (that's OK — reader is working)")
        return True
    except Exception as e:
        print("    FAILED:", e)
        return False


def run():
    print("=" * 40)
    print("TappyTrack Hardware Check")
    print("=" * 40)

    results = {}
    results["piezo"] = check_piezo()
    results["nfc"] = check_nfc()

    print("\n" + "=" * 40)
    print("Summary")
    print("=" * 40)
    all_ok = True
    for name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        if not passed:
            all_ok = False
        print("  {:<12} {}".format(name, status))

    if all_ok:
        print("\nAll hardware checks passed!")
    else:
        print("\nSome checks failed — see details above.")

    return results


run()
