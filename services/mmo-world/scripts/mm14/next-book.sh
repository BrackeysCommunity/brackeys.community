#!/bin/sh
# Writes a sheets root for a rules epoch proof (GDD 18.5): a copy of a
# module's sheets/ and packs/ with one cell a player sees changed (the
# scripted crafter's material, bog-iron's edge, 24 to 25) and one they do
# not (the even-fight target's words). -broken writes instead a root the
# rules build from but a world cannot be bound to (world.params loses
# weather-turn), for the open's dry run to refuse.
#
#   sh scripts/mm14/next-book.sh [-broken] <module dir> <out dir>
#
# The edits are exact line edits, so no other cell or file moves. go.mod is
# copied too, so `harness digest` run inside the out dir reads its book.
set -eu
broken=0
if [ "${1:-}" = -broken ]; then
  broken=1
  shift
fi
if [ "$#" -ne 2 ]; then
  echo "usage: next-book.sh [-broken] <module dir> <out dir>" >&2
  exit 2
fi
src=$1
out=$2
[ -d "$src/sheets" ] && [ -d "$src/packs" ] || {
  echo "next-book: $src holds no sheets/ and packs/" >&2
  exit 1
}
[ -e "$out" ] && {
  echo "next-book: $out already exists" >&2
  exit 1
}
mkdir -p "$out"
cp -R "$src/sheets" "$src/packs" "$src/go.mod" "$out/"

# edit <file> <line holding the row's id> <old line> <new line> swaps the
# first old line after the row's id, and fails unless exactly that line moved.
edit() {
  f=$1
  awk -v id="$2" -v old="$3" -v new="$4" '
    index($0, id) { inrow = 1 }
    inrow && !done && $0 == old { print new; done = 1; next }
    { print }
    END { if (!done) exit 1 }
  ' "$f" >"$f.next" || {
    echo "next-book: no line '$3' after '$2' in $f" >&2
    rm -f "$f.next"
    exit 1
  }
  moved=$(diff "$f" "$f.next" | grep -c '^>' || true)
  [ "$moved" = 1 ] || {
    echo "next-book: $moved lines moved in $f, not 1" >&2
    exit 1
  }
  mv "$f.next" "$f"
}

if [ "$broken" = 1 ]; then
  f="$out/sheets/world/params.json"
  jq '.rows |= map(select(.id != "weather-turn"))' "$f" >"$f.next"
  mv "$f.next" "$f"
  exit 0
fi

edit "$out/sheets/items/materials.json" '"id": "bog-iron"' \
  '        "edge": 24,' '        "edge": 25,'
edit "$out/sheets/meta/targets.json" '"id": "even-fight"' \
  '      "text": "An even fight at equal tier is won 50% of the time, within 5 points",' \
  '      "text": "An even fight at equal tier is won half the time, within 5 points",'
[ "$(jq '[.rows[] | select(.id == "bog-iron") | .vector.edge][0]' "$out/sheets/items/materials.json")" = 25 ] || {
  echo "next-book: bog-iron's edge is not 25" >&2
  exit 1
}
