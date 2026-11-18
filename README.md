# tappytrack

A Spotify player for kids. Tap an NFC card on a small box and its song plays on
your Spotify speaker. Parents choose each card's song in a web dashboard.

```
NFC card ─tap─▶ Pi Pico + PN532 ─HTTPS─▶ API Gateway /tap ─▶ tapCard Lambda ─▶ Spotify Web API ─▶ your speaker
                                              ▲
             Next.js dashboard ───────────────┘  cards, devices, player choice
```

- **Device** ([devices/pi-pico](devices/pi-pico)): MicroPython on a Raspberry Pi
  Pico W. It reads card IDs, posts them to the backend, and beeps when something
  goes wrong. If it can't reach Wi-Fi it opens a setup hotspot.
- **Backend** ([services/aws](services/aws)): API Gateway, Lambda and DynamoDB,
  deployed with AWS SAM. It stores which song belongs to each card, which device
  belongs to which user, and each user's Spotify tokens, then starts playback
  through the Spotify Web API. Telegram notifications are optional.
- **Web app** ([apps/web](apps/web)): Next.js with Spotify sign-in (NextAuth).
  Users claim their device, pick a Spotify speaker, and assign songs to cards
  with live search.

Playback control through the Spotify Web API needs Spotify Premium. While your
Spotify app is in development mode, only users you add in the Spotify developer
dashboard can sign in.

## Repo layout

| Path | What's there |
| --- | --- |
| `apps/web` | Next.js dashboard |
| `services/aws` | SAM template, Lambdas, shared layers, tests |
| `devices/pi-pico` | Device firmware and tests |
| `devices/partslist.md` | [Hardware parts list](devices/partslist.md) (about $14) |
| `devices/pinout.md` | [Wiring diagram](devices/pinout.md) |
| `deploy.sh` | Builds and deploys the backend |

## Setup

You need Node.js 22+, the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
with AWS credentials, and an app in the
[Spotify developer dashboard](https://developer.spotify.com/dashboard).

### 1. Backend

```bash
cp .env.example .env   # fill in the values
./deploy.sh
```

The API URL is the `Prod` stage invoke URL of the stack's API in the API
Gateway console, for example
`https://abc123.execute-api.us-east-1.amazonaws.com/Prod`.

### 2. Web app

```bash
cd apps/web
cp .env.example .env.local   # fill in the values, including the API URL
npm install
npm run dev
```

In the Spotify developer dashboard, add
`<NEXTAUTH_URL>/api/auth/callback/spotify` as a redirect URI.

### 3. Device

1. Wire the Pico, PN532 and piezo as shown in [devices/pinout.md](devices/pinout.md).
2. Hold BOOTSEL while plugging in the Pico, then copy the MicroPython `.uf2`
   from `devices/pi-pico/set-up` onto the drive that appears.
3. Copy `device.example.json` to `device.json` and fill it in. `device_id` is
   any unique name you choose; you'll enter the same ID in the dashboard to
   claim the device.
4. Copy `main.py`, `NFC_PN532.py`, `tap_http.py` and `device.json` to the Pico
   (for example with [Thonny](https://thonny.org): Options › Interpreter › choose
   the Pico's USB port). It may take a couple of restarts to come up.
5. Sign in to the dashboard and enter the device ID.

`check_connectivity.py` is a wiring checker for the buzzer and NFC module. Run
it from Thonny when a new build doesn't respond.

### Connecting a device to Wi-Fi

When the device can't connect, it starts a setup hotspot:

1. Join the `tappytrack` Wi-Fi network (password `12345678`).
2. Open http://192.168.4.1/.
3. Enter your Wi-Fi name and password and save. The device restarts and connects.

## Tests

```bash
cd apps/web && npm test && npm run lint
```

```bash
cd services/aws && npm test
```

```bash
cd devices/pi-pico && python3 -m unittest discover -s tests
```

## License

[MIT](LICENSE)
