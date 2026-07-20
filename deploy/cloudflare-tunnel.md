# Cloudflare Tunnel deployment

Production URL: `https://crm.newmindchen.com`

The CRM remains bound to `127.0.0.1:3000`. Cloudflare Tunnel is the only
public entry point, so the Mac does not need router port forwarding or a
public IP.

## Services

- CRM: `com.russia-crm.server`
- Tunnel: `com.russia-crm.cloudflare-tunnel`

Both are macOS LaunchAgents with `RunAtLoad` and `KeepAlive` enabled.

## Status checks

```bash
launchctl print gui/$(id -u)/com.russia-crm.server
launchctl print gui/$(id -u)/com.russia-crm.cloudflare-tunnel
cloudflared tunnel info tradepulse-crm
curl -I https://crm.newmindchen.com/
```

## Restart

```bash
launchctl kickstart -k gui/$(id -u)/com.russia-crm.server
launchctl kickstart -k gui/$(id -u)/com.russia-crm.cloudflare-tunnel
```

Tunnel configuration and credentials are stored under `~/.cloudflared/`.
The credential JSON and `cert.pem` are secrets and must not be copied into
the repository or shared.

The legacy random `trycloudflare.com` report tunnel and its URL watcher are
disabled. Public report links now use the fixed CRM domain.
