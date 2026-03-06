# X-Connect → VPS Migration Guide

Move the x-connect engagement engine from your local Windows machine to a Linux VPS for 24/7 unattended operation.

---

## 1. VPS Requirements

| Spec | Minimum | Recommended |
|------|---------|-------------|
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| **RAM** | 2 GB | 4 GB (Chrome is hungry) |
| **CPU** | 1 vCPU | 2 vCPU |
| **Disk** | 20 GB SSD | 40 GB SSD |
| **Network** | Shared | Dedicated IP (avoids X flagging) |

> [!TIP]
> Providers like Hetzner (€4/mo), Contabo, or DigitalOcean ($6/mo) work great. Pick a region close to the US for lower latency to X's servers.

---

## 2. Initial Server Setup

SSH into your fresh VPS:

```bash
ssh root@YOUR_VPS_IP
```

### 2.1 System Basics

```bash
# Update & install essentials
apt update && apt upgrade -y
apt install -y curl git unzip wget software-properties-common

# Create a non-root user (optional but recommended)
adduser xbot
usermod -aG sudo xbot
su - xbot
```

### 2.2 Install Node.js (v20 LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # should print v20.x
npm -v
```

### 2.3 Install Google Chrome (for Puppeteer)

The automation and hybrid modes use `puppeteer-core` which needs a real Chrome/Chromium binary.

```bash
# Option A: Google Chrome (recommended — matches your local setup)
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable

# Option B: Chromium (lighter, no Google telemetry)
# sudo apt install -y chromium-browser

# Verify
google-chrome --version
```

> [!IMPORTANT]
> The scripts' `findChrome()` function already checks Linux paths (`/usr/bin/google-chrome`, `/usr/bin/chromium-browser`, etc.), so no code changes needed.

### 2.4 Install Virtual Display (for headful mode)

If your scripts run Chrome in headed mode (not `--headless`), you need a virtual framebuffer:

```bash
sudo apt install -y xvfb
# Run scripts with:
xvfb-run --auto-servernum node scripts/x-feed-engage.js --quota 100
```

If all your scripts already launch Chrome with `headless: true` or `headless: 'new'`, you can skip this.

---

## 3. Transfer the Project

### 3.1 What to Copy

From your local `skills/x-connect/` directory, you need **everything except** `node_modules/`:

```
x-connect/
├── .env                    # ⚠️ NVIDIA API key
├── .gitignore
├── package.json
├── package-lock.json
├── scripts/
│   ├── cookies.json        # ⚠️ Browser session cookies
│   ├── credentials.json    # ⚠️ X API keys
│   ├── engage-core.js
│   ├── news.js
│   ├── stats.js
│   ├── x-api-engage.js
│   ├── x-api-test.js
│   ├── x-feed-engage.js
│   ├── x-analytics-scraper.js
│   └── engagement-bait-filter.md
├── clients/
│   └── default/            # Per-client logs & progress
├── debug/                  # Logs (optional, will regenerate)
├── reply-prompt.md
├── documentation.md
├── operations.md
└── SKILL.md
```

### 3.2 SCP Transfer

```bash
# From your Windows machine (PowerShell):
# First, zip it up (exclude node_modules)
Compress-Archive -Path "C:\Users\admin\Desktop\AgentZero\skills\x-connect\*" -DestinationPath "$env:USERPROFILE\Desktop\x-connect.zip" -Force

# Or use tar if you have Git Bash:
# tar --exclude='node_modules' -czf x-connect.tar.gz -C "C:\Users\admin\Desktop\AgentZero\skills" x-connect

# Upload to VPS
scp "$env:USERPROFILE\Desktop\x-connect.zip" root@YOUR_VPS_IP:/home/xbot/
```

### 3.3 Unpack & Install on VPS

```bash
cd /home/xbot
unzip x-connect.zip -d x-connect
cd x-connect
npm install
```

---

## 4. Configure Secrets

### 4.1 Environment Variables

Edit `.env` on the VPS — never commit secrets to Git:

```bash
nano .env
```

```env
NVIDIA_API_KEY=your-nvidia-api-key-here
NEWS_API_KEY=your-newsapi-key-here   # optional
```

### 4.2 X API Credentials

Verify `scripts/credentials.json` has your X API keys:

```bash
cat scripts/credentials.json
# Should contain: client_id, client_secret, consumer_key, consumer_secret,
#                 access_token, access_token_secret, bearer_token
```

### 4.3 Browser Cookies

`scripts/cookies.json` contains your X.com session cookies for Puppeteer-based modes (automation/hybrid). These **will expire** — you'll need to re-export them periodically.

> [!WARNING]
> Cookies exported from your Windows Chrome session will work on the VPS initially, but may get invalidated if X detects a new IP + user-agent combo. You may need to:
> 1. Log into X from the VPS Chrome instance once to create fresh cookies
> 2. Or use a cookie-export extension to refresh them

### 4.4 Chrome User Data Directory

The automation script references a Chrome profile directory:

```js
const USER_DATA_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'x-profile-v2');
```

On the VPS, this resolves to `~/.openclaw/x-profile-v2`. Create it:

```bash
mkdir -p ~/.openclaw/x-profile-v2
```

If you want to pre-seed the profile with your logged-in session, copy the Chrome profile from your Windows machine:
```
%USERPROFILE%\.openclaw\x-profile-v2\
```

---

## 5. Test Run

### 5.1 Dry Run (no real engagement)

```bash
cd /home/xbot/x-connect

# API mode — doesn't need Chrome
node scripts/x-api-engage.js --mode api --dry-run --verbose

# Hybrid mode — needs Chrome + cookies
node scripts/x-api-engage.js --mode hybrid --dry-run --verbose

# Automation mode — full Puppeteer
xvfb-run --auto-servernum node scripts/x-feed-engage.js --dry-run --verbose
```

### 5.2 API Connectivity Test

```bash
node scripts/x-api-test.js
```

Check output for successful API authentication.

---

## 6. Run as a Background Service

### Option A: systemd (Recommended)

Create a service file:

```bash
sudo nano /etc/systemd/system/x-connect.service
```

```ini
[Unit]
Description=X-Connect Engagement Engine
After=network.target

[Service]
Type=simple
User=xbot
WorkingDirectory=/home/xbot/x-connect
ExecStart=/usr/bin/node scripts/x-api-engage.js --mode hybrid --quota 100 --min-pause 25 --max-pause 55
Restart=on-failure
RestartSec=300
Environment=NODE_ENV=production
StandardOutput=append:/home/xbot/x-connect/debug/service.log
StandardError=append:/home/xbot/x-connect/debug/service-error.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable x-connect
sudo systemctl start x-connect

# Check status
sudo systemctl status x-connect

# View logs
journalctl -u x-connect -f
```

> [!NOTE]
> If using automation mode (Puppeteer), wrap the ExecStart with xvfb-run:
> ```
> ExecStart=/usr/bin/xvfb-run --auto-servernum /usr/bin/node scripts/x-feed-engage.js --quota 100
> ```

### Option B: pm2 (Simpler)

```bash
sudo npm install -g pm2

cd /home/xbot/x-connect

# Start
pm2 start scripts/x-api-engage.js --name x-connect -- --mode hybrid --quota 100 --min-pause 25 --max-pause 55

# Auto-restart on reboot
pm2 startup
pm2 save

# Monitor
pm2 logs x-connect
pm2 monit
```

### Option C: tmux/screen (Quick & Dirty)

```bash
tmux new -s xbot
cd /home/xbot/x-connect
node scripts/x-api-engage.js --mode hybrid --quota 100
# Ctrl+B then D to detach
# tmux attach -t xbot to reattach
```

---

## 7. Scheduling with Cron

Run engagement sessions at specific times instead of 24/7:

```bash
crontab -e
```

```cron
# Run hybrid engagement at 9 AM, 2 PM, and 8 PM UTC daily
0 9 * * * cd /home/xbot/x-connect && /usr/bin/node scripts/x-api-engage.js --mode hybrid --quota 50 >> debug/cron.log 2>&1
0 14 * * * cd /home/xbot/x-connect && /usr/bin/node scripts/x-api-engage.js --mode hybrid --quota 50 >> debug/cron.log 2>&1
0 20 * * * cd /home/xbot/x-connect && /usr/bin/node scripts/x-api-engage.js --mode hybrid --quota 50 >> debug/cron.log 2>&1

# Automation mode (needs xvfb)
0 10 * * * cd /home/xbot/x-connect && /usr/bin/xvfb-run --auto-servernum /usr/bin/node scripts/x-feed-engage.js --quota 100 >> debug/cron.log 2>&1
```

---

## 8. Firewall & Security

```bash
# Allow SSH only
sudo ufw allow OpenSSH
sudo ufw enable

# Optional: allow a stats port if you run stats.js
# sudo ufw allow 8080/tcp

# Lock down SSH (use keys, disable password auth)
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd
```

---

## 9. Mode Decision Matrix

| Situation | Best Mode on VPS |
|-----------|-----------------|
| Want it **free** + low risk | `--mode hybrid` (Puppeteer reads, API writes) |
| Have **paid API credits** | `--mode api` (no Chrome needed, simplest) |
| Need **full browser automation** | `x-feed-engage.js` + xvfb (most complex) |
| Running **multiple clients** | `--mode api` per client via separate pm2 processes |

> [!TIP]
> **API mode is easiest on a VPS** — no Chrome, no cookies, no xvfb. If you have the API credits, use it. Hybrid is the best middle ground for free-tier usage.

---

## 10. Monitoring & Maintenance

```bash
# Check engagement logs
tail -f /home/xbot/x-connect/debug/x-feed-engage.log

# Check per-client logs
cat /home/xbot/x-connect/clients/default/engage.log

# View today's progress
cat /home/xbot/x-connect/debug/feed-progress-$(date +%Y-%m-%d).json

# Restart after code updates
sudo systemctl restart x-connect
# or: pm2 restart x-connect

# Pull updates (if you set up Git)
cd /home/xbot/x-connect && git pull && npm install
sudo systemctl restart x-connect
```

---

## Quick Checklist

- [ ] VPS provisioned with Ubuntu 22/24 LTS
- [ ] Node.js v20 installed
- [ ] Chrome/Chromium installed (skip if API-only mode)
- [ ] xvfb installed (skip if API-only or headless)
- [ ] Project files transferred (`.env`, `credentials.json`, `cookies.json`)
- [ ] `npm install` completed
- [ ] `.env` configured with NVIDIA API key
- [ ] Dry-run passes without errors
- [ ] Service/pm2 configured for auto-restart
- [ ] Firewall locked down
- [ ] Cron schedule set (optional)
