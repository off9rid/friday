#!/bin/zsh
# Records several takes back to back: ./batch.sh name "line" [name "line" ...]
# Each take: fresh vault + warm model first, then take.mjs with a watchdog (SIGINT -> it restores his screen).
cd ~/Friday/demo
while (( $# >= 2 )); do
  name=$1; line=$2; shift 2
  curl -s -XPOST localhost:8957/api/reset >/dev/null; sleep 1; curl -s -XPOST localhost:8957/api/warm >/dev/null; sleep 7
  node take.mjs $name "$line" > takes/$name.out 2>&1 & P=$!
  for i in $(seq 1 170); do kill -0 $P 2>/dev/null || break; sleep 1; done
  kill -0 $P 2>/dev/null && { kill -INT $P; echo "WATCHDOG stopped $name"; sleep 5; }
  echo "== $name: $(tail -1 takes/$name.log)"
done
osascript -e 'tell application "System Events" to get name of every process whose visible is true and background only is false'
