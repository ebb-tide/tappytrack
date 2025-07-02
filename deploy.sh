#!/bin/bash

# Load environment variables from .env file
source .env

sam build --template-file aws/template.yaml

# Deploy using SAM CLI with parameters
sam deploy \
  --template-file aws/template.yaml \
  --stack-name tappytrack \
  --parameter-overrides \
    InternalSecret="$INTERNAL_SECRET" \
    SpotifyClientId="$SPOTIFY_CLIENT_ID" \
    SpotifyClientSecret="$SPOTIFY_CLIENT_SECRET" 
