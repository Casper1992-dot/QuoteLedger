# Quote Ledger — self-hosting guide

This folder is a complete, self-contained copy of the prototype that runs on any Node host (Replit, Render, Railway, Fly.io or your own server).

```
quote-ledger/
├── public/index.html   ← the whole app (data, UI, OCR) in one file
├── server.js           ← serves the page + forwards Claude calls with your API key
├── package.json        ← "npm start" runs server.js (no dependencies to install)
├── .replit             ← Replit run settings
└── README.md
```

**Why a server?** The Claude features (RFx co-pilot, live extraction, adding responses, plain-language questions) need an Anthropic API key. The key must stay on the server. Never put it in `index.html`, because anyone could copy it from the page.

---

## What you need

1. **An Anthropic API key.** Create one at https://console.anthropic.com → *API Keys*. Add a small credit balance and set a monthly spend limit there. A full demo run costs a few dollars at most.
2. **Node 18 or newer** on the host. Replit, Render and Railway all provide this by default.

## Settings (environment variables / "Secrets")

| Name | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes, for the AI features | Your API key. Without it the page still works on the reference data, but Claude features are greyed out. |
| `DEMO_PASSCODE` | Recommended | If set, only visitors who open the link with `?key=<passcode>` can use Claude. This stops strangers spending your credit. |
| `CLAUDE_MODEL` | No | Defaults to `claude-sonnet-5`. |
| `RATE_LIMIT_PER_HOUR` | No | AI calls allowed per visitor per hour (default 60). |
| `PORT` | No | The host usually sets this for you. |

---

## Option A: Replit (easiest)

1. Go to https://replit.com → **Create App** → **Import from GitHub**, *or* choose the **Node.js** template and upload the files.
   - To upload: in the file panel, drag the contents of this folder in, so that `server.js`, `package.json` and `.replit` sit at the top level and `index.html` sits in a folder called `public`.
2. Open **Tools → Secrets** and add:
   - `ANTHROPIC_API_KEY` = your key
   - `DEMO_PASSCODE` = something like `aerchain-2026`
3. Click **Run**. The preview should show Quote Ledger, and the console should say `AI enabled`.
4. To get a permanent public URL, click **Deploy** → **Autoscale** (or **Reserved VM**) → confirm the run command `npm start` → **Deploy**. Replit gives you a `https://<name>.replit.app` link.
   - Remember that Secrets must also be present in the deployment. Replit copies them over, but check the Deployment's *Secrets* panel.
5. Share `https://<name>.replit.app/?key=aerchain-2026`. The passcode is saved in the visitor's browser and removed from the address bar.

## Option B: Render (free tier available)

1. Put this folder in a GitHub repository (public or private).
2. On https://render.com → **New → Web Service** → connect the repo.
3. Set **Runtime** to Node, **Build command** to `npm install`, and **Start command** to `npm start`.
4. Under **Environment**, add `ANTHROPIC_API_KEY` (and `DEMO_PASSCODE`).
5. Click **Create Web Service**. Your link is `https://<name>.onrender.com`. Free instances sleep when idle, so the first visit can take about 30 seconds.

## Option C: Railway

1. On https://railway.app → **New Project → Deploy from GitHub repo** (or run `railway up` from this folder with the Railway CLI).
2. In the service → **Variables**, add `ANTHROPIC_API_KEY` (and `DEMO_PASSCODE`).
3. Under **Settings → Networking**, click **Generate Domain** to get a public URL.

## Option D: static only (Netlify Drop, GitHub Pages, Vercel)

If you only need people to *look around*, drag the `public` folder onto https://app.netlify.com/drop. You'll get a link in seconds. Everything calculated works (comparison, sources, review, plan builder, memo, photo text recognition). The Claude features will show as unavailable, because there's no server holding the key.

---

## Check it works

1. Open `https://<your-url>/api/health`. You should see `{"ok":true,...}`. If you see `ok:false`, the API key isn't set.
2. Open the app, go to the **Ask** tab, and click the first suggested question. You should get a plan and an answer within 10–30 seconds.
3. If you set a passcode, open the plain URL without `?key=` in a private window. The Claude features should report that access was declined.

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Claude isn’t available in this view” | `/api/health` isn't OK. Set `ANTHROPIC_API_KEY` and restart or redeploy. |
| “Claude access was declined for this page” | A passcode is set and the visitor opened the link without `?key=`. |
| “Rate limited” | Wait an hour, or raise `RATE_LIMIT_PER_HOUR`. On the Anthropic side, check your usage limits. |
| “Claude did not return valid JSON” | Retry. If it keeps happening, try `CLAUDE_MODEL=claude-opus-5-5`. |
| Photo upload says the text reader couldn’t start | The page loads the text reader from cdn.jsdelivr.net. Check that the visitor's network allows it. |

## Notes

- **Data stays in each visitor's browser.** Uploads, review decisions and drafts are saved in that visitor's own browser (localStorage). Nothing is stored on the server, and visitors don't see each other's changes.
- **What goes to Claude:** only the text of uploaded documents (and images for photos) and the questions typed are sent, through your server, to the Anthropic API. The page's reference data and calculations stay in the browser.
- **Updating:** replace `public/index.html` with a newer export and restart.
