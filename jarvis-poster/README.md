# Jarvis Poster

A desktop assistant that posts one video to **TikTok**, **Instagram Reels** and **YouTube (Shorts)** at the same time.

Drop in a video, write one caption and your hashtags, then press **POST EVERYWHERE** or type a command like `post to tiktok and youtube`. All three uploads run in parallel, each with its own progress bar, and Jarvis reads the results out loud.

It uses only the official platform APIs, so your accounts aren't at risk of being flagged for automation.

## Install

**Download an installer:** open the repository's **Actions** tab, then **Build Jarvis Poster**, then the latest run. Scroll to **Artifacts** and download:

| Your computer | File | How to install |
|---|---|---|
| Windows | `Jarvis-Poster-Windows` → `Jarvis Poster Setup 1.0.0.exe` | Run it. It adds a desktop shortcut. If SmartScreen appears, click **More info → Run anyway** (the app isn't code-signed). |
| Mac | `Jarvis-Poster-Mac` → `.dmg` | Drag the app to Applications. The first time, **right-click → Open** (the app isn't notarized). |
| Linux | `Jarvis-Poster-Linux` → `.AppImage` | `chmod +x` the file, then double-click it. |

**Or run it from source** (needs Node.js 20 or newer):

```bash
cd jarvis-poster
```

```bash
npm install
```

```bash
npm start
```

## One-time setup: connect your accounts

TikTok, Instagram and YouTube only allow posting through a developer app that you register with them. It's free and you only do it once. Each card on the **Accounts** tab links to the right page and lists the steps.

### YouTube
1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable **YouTube Data API v3**.
2. Configure the OAuth consent screen (External) and add your Google account as a **test user**.
3. Create credentials of type **OAuth client ID → Desktop app**.
4. Paste the Client ID and Client Secret into Jarvis Poster, then click **Connect** and approve in your browser.

> Until Google audits your project, the API locks videos uploaded through it to **private**. To post publicly, request an audit through the YouTube API Services audit form.

### TikTok
1. At [TikTok for Developers](https://developers.tiktok.com/apps), create an app and add **Login Kit** and **Content Posting API**.
2. Choose platform **Desktop** and set the redirect URI to `http://localhost:53682/callback`.
3. Request the scopes `user.info.basic`, `video.upload` and `video.publish`.
4. Paste the Client Key and Client Secret, then click **Connect**.

> Until TikTok audits your app, direct posts can only be **private** (Jarvis switches to private automatically and tells you). Alternatively, choose **Send to TikTok drafts** mode: the video lands in your TikTok app's inbox and you tap Post there.

### Instagram
1. Your Instagram account must be a **Professional** account (Business or Creator).
2. At [Meta for Developers](https://developers.facebook.com/apps), create an app with the **Instagram** product.
3. Generate an access token with content-publishing permission (`instagram_business_content_publish` or `instagram_content_publish`) and copy your Instagram user ID.
4. Paste both, pick the matching token type, then click **Verify**.

## Commands

Type these in the command bar under the glowing core:

| Command | What it does |
|---|---|
| `post everywhere` | Posts to every connected platform |
| `post to tiktok and instagram` | Posts to just those platforms |
| `select youtube` | Selects platforms without posting |
| `connect tiktok` | Starts sign-in for a platform |
| `status` | Lists connected accounts and whether a video is loaded |
| `history`, `accounts`, `mission` | Switch tabs |
| `voice off` / `voice on` | Mute or unmute spoken replies |

## Notes

- **Video formats:** MP4, MOV, M4V or WEBM. Vertical 9:16 under 3 minutes works on all three platforms; YouTube treats it as a Short.
- **Captions:** your caption and hashtags go to TikTok and Instagram (2,200-character limit) and become the YouTube description. The YouTube title is separate.
- **Where keys are stored:** keys and tokens stay on your computer, encrypted with your system keychain where available (`config.enc` in the app's data folder). They're only ever sent to the platform they belong to.
- **Tests:** `npm test` runs each platform's full upload flow against a mocked API.
