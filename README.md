# Private Send (Supabase version) — very simple setup

Yes ✅ this version is now **Supabase-based**.

You upload a file -> app gives 6-digit code -> friend downloads -> file auto-deletes.

---

## What you need
- Supabase account
- Node.js installed

---

## Step 1) Create Supabase project
1. Go to https://supabase.com
2. Click **New project**
3. Wait until it finishes

---

## Step 2) Create storage bucket
1. Open your Supabase project
2. Click **Storage**
3. Click **New bucket**
4. Bucket name: `private-send-files`
5. Keep it **Private**
6. Create bucket

---

## Step 3) Create transfers table
1. In Supabase, click **SQL Editor**
2. Click **New query**
3. Paste this SQL and run:

```sql
create table if not exists public.transfers (
  code text primary key,
  object_path text not null,
  original_name text not null,
  content_type text,
  created_at timestamptz not null default now()
);
```

---

## Step 4) Copy 2 values from Supabase
1. Go to **Project Settings**
2. Go to **API**
3. Copy:
   - **Project URL** (this is `SUPABASE_URL`)
   - **service_role key** (this is `SUPABASE_SERVICE_ROLE_KEY`)

⚠️ Keep service_role key secret.

---

## Step 5) Create `.env` file in this project
Create `.env` and paste this:

```bash
PORT=3000
UPLOAD_PASSWORD=mysecret123
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_BUCKET=private-send-files
```

### How to change upload password later
Just change this line in `.env`:

```bash
UPLOAD_PASSWORD=newpassword456
```

Save file, then restart server.

---

## Step 6) Install and run
```bash
npm install
npm start
```

Open browser:
`http://localhost:3000`

---

## How to use
### Upload
1. Enter upload password
2. Pick file
3. Click Upload
4. Copy 6-digit code

### Download
1. Enter 6-digit code
2. Click Download
3. File downloads and code becomes invalid

---

## If something fails
- **Wrong upload password**: password in website does not match `.env`
- **Code not found/already used**: wrong code, expired code, or already downloaded
- **Missing SUPABASE_URL or key**: `.env` is missing values
