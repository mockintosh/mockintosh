#!/bin/sh
# Build Terminal's WebAssembly programs into public/wasi/ with wasi-sdk.
#
#   npm run wasi:build
#
# Downloads wasi-sdk and the sources (pinned, checksummed) into
# node_modules/.cache/mockintosh-wasi, then compiles:
#   lua.wasm      Lua 5.4.7
#   kilo.wasm     antirez's kilo editor (raw mode, full screen)
#   sqlite3.wasm  SQLite's command-line shell
# and copies CPython's WASI build (interpreter and standard library, one zip).
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/scripts/wasi"
CACHE="$ROOT/node_modules/.cache/mockintosh-wasi"
OUT="$ROOT/public/wasi"
SDK_VERSION=34
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) SDK_ARCH=arm64-macos ;;
  Darwin-x86_64) SDK_ARCH=x86_64-macos ;;
  Linux-x86_64) SDK_ARCH=x86_64-linux ;;
  Linux-aarch64) SDK_ARCH=arm64-linux ;;
  *) echo "No wasi-sdk for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
SDK="$CACHE/wasi-sdk-$SDK_VERSION.0-$SDK_ARCH"
mkdir -p "$CACHE/src" "$OUT"

fetch() { # url file sha256
  if [ ! -f "$2" ]; then curl -fsSL -o "$2.part" "$1" && mv "$2.part" "$2"; fi
  echo "$3  $2" | shasum -a 256 -c - >/dev/null || { echo "Checksum mismatch: $2" >&2; exit 1; }
}

if [ ! -x "$SDK/bin/clang" ]; then
  curl -fsSL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$SDK_VERSION/wasi-sdk-$SDK_VERSION.0-$SDK_ARCH.tar.gz" | tar xz -C "$CACHE"
fi
fetch https://www.lua.org/ftp/lua-5.4.7.tar.gz "$CACHE/src/lua.tar.gz" 9fbf5e28ef86c69858f6d3d34eccc32e911c1a28b4120ff3e84aaa70cfbf1e30
fetch https://raw.githubusercontent.com/antirez/kilo/323d93b29bd89a2cb446de90c4ed4fea1764176e/kilo.c "$CACHE/src/kilo.c" 4a44dd0e41670a9e49ecccb338ee199334f0dd472fc7f86467569cf99c391abe
fetch https://www.sqlite.org/2026/sqlite-amalgamation-3530400.zip "$CACHE/src/sqlite.zip" 1e71ddf93849c6a6ecf58b827c0692073d2dd7ee40196158068f7b29f422e87d
fetch https://github.com/brettcannon/cpython-wasi-build/releases/download/v3.14.7/python-3.14.7-wasi_sdk-24.zip "$CACHE/python.zip" 2e064d3fb8172471d39d741348efa722349c40b96301f69968dff714999c584b
tar xzf "$CACHE/src/lua.tar.gz" -C "$CACHE/src"
unzip -oq "$CACHE/src/sqlite.zip" -d "$CACHE/src"

CC="$SDK/bin/clang --target=wasm32-wasip1 --sysroot=$SDK/share/wasi-sysroot"
CFLAGS="-O2 -I$HERE/include -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID"
LIBS="-lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-getpid"
STRIP="-Wl,--strip-all"

# Lua: errors unwind with setjmp/longjmp, which WebAssembly exceptions carry.
LUA="$CACHE/src/lua-5.4.7/src"
$CC $CFLAGS -mllvm -wasm-enable-sjlj -DLUA_USE_C89 -include stdio.h -include "$HERE/lua_wasi.h" -o "$OUT/lua.wasm" \
  $(ls "$LUA"/*.c | grep -v -e '/luac\.c$' -e '/onelua\.c$') "$HERE/mactty.c" -lsetjmp $LIBS $STRIP

$CC $CFLAGS -o "$OUT/kilo.wasm" "$CACHE/src/kilo.c" "$HERE/mactty.c" $LIBS $STRIP

SQLITE="$CACHE/src/sqlite-amalgamation-3530400"
$CC $CFLAGS -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_OMIT_WAL -DSQLITE_OMIT_SHARED_CACHE \
  -DSQLITE_OMIT_POPEN -DSQLITE_OMIT_RANDOMNESS -DSQLITE_DEFAULT_LOCKING_MODE=1 -DSQLITE_NOHAVE_SYSTEM \
  -DHAVE_READLINE=0 -o "$OUT/sqlite3.wasm" "$SQLITE/shell.c" "$SQLITE/sqlite3.c" "$HERE/mactty.c" $LIBS $STRIP

cp "$CACHE/python.zip" "$OUT/python-3.14.zip"
ls -l "$OUT"
