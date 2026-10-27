#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instale o Node.js em https://nodejs.org e rode de novo."; read; exit 1; }
(sleep 1; open http://localhost:3333) &
node server.js
