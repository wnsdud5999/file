# Personal Cloud with Supabase (password protected)

This is a small web app for personal cloud storage:
- password login,
- upload files,
- download files,
- delete files,
- file list with size + updated time.

The app keeps a simple password gate on the server, then uses Supabase Storage behind the scenes.

## Setup

### 1) Create Supabase project + bucket

1. Create a project in Supabase.
2. Create a bucket (for example `personal-cloud`).
3. Copy these values from project settings:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

### 2) Configure environment variables

Create a `.env` (or set env vars in your host):

```bash
PORT=3000
SESSION_SECRET=replace-with-long-random-value
PASSWORD_SALT=replace-with-random-salt
EDITOR_PASSWORD_HASH=<optional sha256 hash>
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_BUCKET=personal-cloud
```

Password behavior:
- If `EDITOR_PASSWORD_HASH` is set, it is used.
- Otherwise it falls back to default password: `wnsdud5999@`.

To generate your own password hash:

```bash
node -e "const c=require('crypto'); const salt='YOUR_SALT'; const pw='YOUR_PASSWORD'; console.log(c.createHash('sha256').update(`${salt}:${pw}`).digest('hex'))"
```

### 3) Run

```bash
npm start
```

Open `http://localhost:3000`.

## Notes

- This app uses `SUPABASE_SERVICE_ROLE_KEY` on the server only (never expose it in client code).
- Upload API currently accepts base64 JSON payloads, intended for personal use and moderate file sizes.
