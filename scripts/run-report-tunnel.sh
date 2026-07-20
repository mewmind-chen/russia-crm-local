#!/bin/zsh -l
export HOME="/Users/ylf"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
exec /opt/homebrew/bin/cloudflared tunnel --no-autoupdate --protocol http2 --loglevel info --logfile "/Users/ylf/Desktop/projects/russia-crm-local/logs/report-tunnel.log" --url http://127.0.0.1:3000
