#!/usr/bin/env bash
# Build and deploy the AWS backend (services/aws) with the SAM CLI.
# Secrets are read from .env at the repo root; see .env.example.
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "Missing .env at the repo root. Copy .env.example and fill it in." >&2
  exit 1
fi
set -a
source .env
set +a

: "${INTERNAL_SECRET:?INTERNAL_SECRET is not set in .env}"
: "${SPOTIFY_CLIENT_ID:?SPOTIFY_CLIENT_ID is not set in .env}"
: "${SPOTIFY_CLIENT_SECRET:?SPOTIFY_CLIENT_SECRET is not set in .env}"

sam build --template-file services/aws/template.yaml

# Telegram notifications are optional; leave both values empty to disable them.
sam deploy \
  --template-file services/aws/template.yaml \
  --stack-name tappytrack \
  --parameter-overrides \
    InternalSecret="$INTERNAL_SECRET" \
    SpotifyClientId="$SPOTIFY_CLIENT_ID" \
    SpotifyClientSecret="$SPOTIFY_CLIENT_SECRET" \
    TelegramBotToken="${TELEGRAM_BOT_TOKEN:-}" \
    TelegramChatId="${TELEGRAM_CHAT_ID:-}"
