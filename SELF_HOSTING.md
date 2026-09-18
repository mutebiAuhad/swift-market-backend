# Self-hosting Swift Market on your Kali machine

Kali is Debian-based, so this is the same as hosting on any Debian/Ubuntu
box — nothing pentest-specific about it. The important differences from a
cloud host (Render, Railway, etc.) are: your machine must stay powered on
and connected, and you're responsible for the things a cloud host would
normally do for you (firewall, HTTPS certificate, keeping the process
alive, restarting after a reboot).

## 1. Install Node.js

Kali's default repos often carry an old Node version. Use NodeSource instead:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # confirm v20.x
```

## 2. Get the project onto the machine and install dependencies

```bash
cd ~
unzip swift-market-backend.zip
cd swift-market-backend
npm install
cp .env.example .env
nano .env   # fill in real values — see the main README.md
```

`better-sqlite3` compiles a native module on install — if that fails,
install build tools first:
```bash
sudo apt-get install -y build-essential python3
```

## 3. Test it runs

```bash
npm start
```
Visit `http://localhost:3000` from a browser on the same machine, or
`http://<kali-machine-LAN-IP>:3000` from another device on your network
(find your LAN IP with `ip a`). Stop it with Ctrl+C once confirmed.

## 4. Keep it running permanently — systemd

Don't rely on a terminal staying open. Create a systemd service so it
starts on boot and restarts if it crashes:

```bash
sudo nano /etc/systemd/system/swiftmarket.service
```

Paste (adjust the paths and username to match your setup — find your
username with `whoami`):

```ini
[Unit]
Description=Swift Market backend
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/swift-market-backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/home/YOUR_USERNAME/swift-market-backend/.env

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable swiftmarket
sudo systemctl start swiftmarket
sudo systemctl status swiftmarket   # confirm it's running
journalctl -u swiftmarket -f        # live logs
```

## 5. Put it behind Nginx and get real HTTPS

Payment providers (Flutterwave, MTN MoMo callbacks) and browsers expect
HTTPS on a real domain, not `http://` on a raw port.

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/swiftmarket`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/swiftmarket /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com   # issues a free HTTPS certificate
```
Set `PUBLIC_URL=https://your-domain.com` in `.env` and restart:
`sudo systemctl restart swiftmarket`.

## 6. Point your domain at this machine

This only works if your Kali machine has a reachable public IP:

- **On a cloud VPS** (DigitalOcean, Linode, a cheap Ugandan VPS provider,
  etc.) — straightforward: create an A record for your domain pointing
  at the VPS's public IP.
- **On a home network** — your ISP router's public IP is shared and
  usually changes periodically (dynamic IP). You'd need to: forward
  ports 80/443 on your router to this machine's LAN IP, and use a
  dynamic DNS service (e.g. DuckDNS, No-IP) so your domain keeps working
  when your home IP changes. This also means your site's uptime depends
  on your home power and internet staying up — fine for testing, risky
  for a real business people pay real money through.

**Recommendation**: use Kali to build and test everything (steps 1–4
work great locally), but for the live, public version, run this same
code on a small cloud VPS (from ~$4–6/month) instead of your home
machine — same steps, just a different box with a stable public IP.

## 7. Firewall and basic hardening

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo apt-get install -y fail2ban   # blocks repeated failed SSH login attempts
```
Also: don't expose port 3000 directly to the internet — only Nginx (80/443)
should be open; Node stays on `localhost:3000` behind the proxy, which is
already how the config above is set up.

## 8. Backups

Your SQLite file is your entire database:
```bash
crontab -e
```
Add a daily backup line:
```
0 3 * * * cp /home/YOUR_USERNAME/swift-market-backend/swiftmarket.db /home/YOUR_USERNAME/backups/swiftmarket-$(date +\%F).db
```
(create the `backups` folder first: `mkdir -p ~/backups`)
