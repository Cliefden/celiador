#!/usr/bin/env bash
# Typechecks swift/CeliadorAPI.swift (Swift 5 and 6 language modes, warnings as
# errors) and runs the decode test against it. Needs swiftc: Xcode on macOS
# (DEVELOPER_DIR=... if it isn't the selected one), the Swift toolchain on Linux.
set -euo pipefail
cd "$(dirname "$0")/.."

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

swiftc --version
for mode in 5 6; do
  echo "typecheck: swift-version $mode"
  swiftc -parse-as-library -swift-version "$mode" -warnings-as-errors -typecheck swift/CeliadorAPI.swift
done

echo "decode test"
swiftc -parse-as-library -swift-version 6 swift/CeliadorAPI.swift test/swift/DecodeTest.swift -o "$out/decode-test"
"$out/decode-test"
