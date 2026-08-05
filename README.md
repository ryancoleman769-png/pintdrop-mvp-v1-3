# PintDrop Interactive Demo v1.3

Open `index.html` in Chrome or Edge.

New in v1.3:
- Natural customer → recipient SMS → voucher journey
- iPhone-style recipient message
- Apple Wallet-style voucher with enlarge/scan animation
- Pub QR scanner simulation
- Sender notification after redemption
- Recipient SMS and voucher removed from the main navigation

This is a browser-only interactive sales demo. No real payment or SMS is sent.

## Deploy to Vercel (via GitHub)

1. Sign in to GitHub CLI (one-time):
   ```powershell
   gh auth login --web --git-protocol https
   ```
2. From this folder, run:
   ```powershell
   .\deploy.ps1
   ```
3. Open [vercel.com/new](https://vercel.com/new), sign in with GitHub, import `pintdrop-mvp-v1.3`, and click **Deploy**.

No build step is required — Vercel serves the static files directly.
