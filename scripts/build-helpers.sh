#!/bin/zsh
# Compiles the Swift helpers once, for both Mac architectures, so the packaged
# app does not need Xcode on the stranger's machine.
set -e
cd "$(dirname "$0")/.."
mkdir -p build/bin build/obj
for h in winlist agenda micwatch; do
  swiftc -O -target arm64-apple-macos12 -o build/obj/$h-arm64 electron/$h.swift
  swiftc -O -target x86_64-apple-macos12 -o build/obj/$h-x64 electron/$h.swift
  lipo -create -output build/bin/$h build/obj/$h-arm64 build/obj/$h-x64
done
rm -rf build/obj
echo "helpers in build/bin"
