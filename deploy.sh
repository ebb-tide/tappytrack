#!/bin/bash

# Load environment variables from .env file
source .env

sam build --template-file services/aws/template.yaml

# Deploy using SAM CLI with parameters
sam deploy \
  --template-file services/aws/template.yaml \
  --stack-name tappytrack \
  --parameter-overrides \
    InternalSecret="$INTERNAL_SECRET" \
    SpotifyClientId="$SPOTIFY_CLIENT_ID" \
    SpotifyClientSecret="$SPOTIFY_CLIENT_SECRET" \
    TelegramBotToken="$TELEGRAM_BOT_TOKEN" \
    TelegramChatId="$TELEGRAM_CHAT_ID"
