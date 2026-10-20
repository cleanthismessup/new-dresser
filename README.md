# New Dresser

A personal closet app for iPhone. Keep track of your clothes, outfits, laundry and wishlist, and get a daily outfit pick based on the weather.

It's a home-screen web app. It runs entirely on your phone, works offline, and your data never leaves the phone. GitHub Pages only hosts the files so iOS can install them.

## Install on your iPhone

1. **Turn on GitHub Pages** (one time). In this repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
   - GitHub Pages is free for public repos. The repo holds only the app's code, never your closet data.
   - Every push to `main` publishes the app (see the **Actions** tab).
2. In **Safari**, open `https://<your-github-username>.github.io/new-dresser/`.
3. Tap **Share → Add to Home Screen**. Then open **Dresser** from your home screen.

## Turn on photo recognition (free)

1. Go to [aistudio.google.com](https://aistudio.google.com), sign in, and tap **Get API key → Create API key**.
2. In the app, tap the settings button (top right) → **Photo recognition**, paste the key and tap **Save**. The app checks the key and picks a free Gemini model.

The key is stored only on your phone. On Google's free tier, Google may use the photos you send to improve its products.

## Back up

Settings → **Back up now** → **Save to Files** → iCloud Drive. To restore on a new phone: install the app, then Settings → **Restore from a backup**. The app reminds you on the Today tab when your last backup is more than 14 days old.

## What's inside

| File | What it does |
| --- | --- |
| `public/index.html`, `styles.css`, `app.js` | The app: closet, outfits, Today pick, laundry, wishlist |
| `public/gemini.js` | Recognizes brand and model, and finds official product photos (Gemini with Google Search) |
| `public/weather.js` | Live forecast from [Open-Meteo](https://open-meteo.com) (free, no key) |
| `public/backup.js` | Backup and restore files |
| `public/cutout.js` | Pastes iOS "Lift subject" cutouts and removes backgrounds on the phone ([@imgly/background-removal](https://github.com/imgly/background-removal-js), AGPL) |
| `public/sw.js` | Makes the app open offline |
| `index.html` (root) | The earlier single-file prototype (Claude artifact) |

## Run it on a computer

```sh
npx serve public
```

Then open the address it prints. Location and offline mode need `https://` or `localhost`.
