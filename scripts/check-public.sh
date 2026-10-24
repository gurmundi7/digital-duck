#!/bin/zsh
# A packaged build is a public build: vite bundles private/ whenever it exists,
# so refuse rather than ship private skins. Private skins run from a checkout.
cd "$(dirname "$0")/.."
if [ -e private ]; then
  echo "private/ is present, so this build would ship private skins. Move it aside first."
  exit 1
fi
