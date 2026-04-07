# Private Send (one-time 6-digit download code)

This is a private "send anywhere" style file share.

## How it works
1. Uploader enters **upload password** and uploads a file.
2. Website gives a **random 6-digit code**.
3. Receiver enters that 6-digit code and downloads the file.
4. File is **deleted automatically after first successful download**.

## Setup

## Quick setup

### 1) Install and run
```bash
npm install
npm start
```

### 2) Set your upload password (important)
Default password is `upload123!` (change this!).

Run server with your own password:
```bash
UPLOAD_PASSWORD="my-secret-upload-pass" npm start
```

Optional custom port:
```bash
PORT=3000 UPLOAD_PASSWORD="my-secret-upload-pass" npm start
```

### 3) Open in browser
`http://localhost:3000`

---

## Notes
- Code is always 6 digits.
- Download code is one-time use.
- Expired files are cleaned up automatically (24 hours).
- Files are stored on server disk in `data/uploads` until downloaded/expired.

Open `http://localhost:3000`.

## Troubleshooting
- "Wrong upload password" → check `UPLOAD_PASSWORD` value.
- "Code not found or already used" → code is wrong, expired, or already downloaded.
- If server restarts and data folder is removed, old codes will not work.
