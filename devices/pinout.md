# Device Pinouts

## Raspberry Pi Pico WH (2022)

```
                    ┌──────────────────┐
              GP0  ─┤ 1              40├─ VBUS
              GP1  ─┤ 2              39├─ VSYS
              GND  ─┤ 3              38├─ GND
              GP2  ─┤ 4              37├─ 3V3_EN
              GP3  ─┤ 5              36├─ 3V3(OUT)
              GP4  ─┤ 6              35├─ ADC_VREF
              GP5  ─┤ 7              34├─ GP28
              GND  ─┤ 8              33├─ GND
              GP6  ─┤ 9              32├─ GP27
              GP7  ─┤10              31├─ GP26
              GP8  ─┤11              30├─ RUN
              GP9  ─┤12              29├─ GP22
              GND  ─┤13              28├─ GND
             GP10  ─┤14              27├─ GP21
             GP11  ─┤15              26├─ GP20
             GP12  ─┤16              25├─ GP19
             GP13  ─┤17              24├─ GP18
              GND  ─┤18              23├─ GND
             GP14  ─┤19              22├─ GP17
             GP15  ─┤20              21├─ GP16
                    └──────────────────┘
```

---

## PN532 NFC Module V3

```
        ┌─────────────────────────┐
        │      PN532 NFC V3       │
        │                         │
        │  [I2C/SPI/UART switch]  │
        │                         │
        └──┬──┬──┬──┬──┬──┬──┬──┬─┘
           │  │  │  │  │  │  │  │
          VCC GND SDA SCL IRQ RSTO MISO MOSI
           1  2   3   4   5   6    7    8

(Pin availability depends on mode - I2C uses SDA/SCL, SPI uses MISO/MOSI/SCK/SS)
```

---

## DIYables Passive Piezo Module

```
        ┌─────────────┐
        │   PIEZO     │
        │             │
        └──┬──┬──┬────┘
           │  │  │
           S  +  -
          SIG VCC GND
           1  2   3
```

---

## Wiring Connections (Current)

| Pico Pin     | Component | Component Pin |
|--------------|-----------|---------------|
| GP3 (pin 5)  | PN532 NFC | MOSI          |
| GP4 (pin 6)  | PN532 NFC | MISO          |
| GP5 (pin 7)  | PN532 NFC | CS (SS)       |
| GP6 (pin 9)  | PN532 NFC | SCK           |
| GP8 (pin 11) | Piezo     | SIG (S)       |
| 3V3 (pin 36) | PN532 NFC | VCC           |
| 3V3 (pin 36) | Piezo     | VCC (+)       |
| GND          | PN532 NFC | GND           |
| GND          | Piezo     | GND (-)       |

**Note:** The PN532 is configured for SPI mode. Pin assignments avoid the first/last 4 pins on each side of the Pico for mounting clearance.

---

## Wiring Connections (Original)

| Pico Pin     | Component | Component Pin |
|--------------|-----------|---------------|
| GP0 (pin 1)  | PN532 NFC | MISO          |
| GP1 (pin 2)  | PN532 NFC | CS (SS)       |
| GP2 (pin 4)  | PN532 NFC | SCK           |
| GP3 (pin 5)  | PN532 NFC | MOSI          |
| GP15 (pin 20)| Piezo     | SIG (S)       |
| 3V3 (pin 36) | PN532 NFC | VCC           |
| 3V3 (pin 36) | Piezo     | VCC (+)       |
| GND          | PN532 NFC | GND           |
| GND          | Piezo     | GND (-)       |

**Note:** Original wiring used pins at the edges of the Pico which caused mounting clearance issues.
