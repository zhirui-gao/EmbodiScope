#!/usr/bin/env sh
# Serve EmbodiScope + local datasets:  ./serve.sh /data/datasets [/more] [--port 8686] [--host 0.0.0.0]
command -v node >/dev/null 2>&1 || { echo "Node.js >= 18 is required: https://nodejs.org"; exit 1; }
[ -z "$1" ] && { echo "usage: ./serve.sh <dataset-folder> [more folders] [--port 8686]"; exit 1; }
exec node "$(dirname "$0")/scripts/serve.mjs" "$@"
