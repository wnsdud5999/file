# Private Send (Supabase only, no custom server)

Yes — this is Supabase-only.
No Node backend needed for upload/download flow.

## What it does
1. Upload user logs in (Supabase Auth email/password)
2. Upload file (max 50 MB)
3. Get random 6-digit code
4. Other person enters code to download
5. File/code gets deleted after download

---

## Step-by-step setup

### Step 1) Create Supabase project
- Go to https://supabase.com
- Create project

### Step 2) Create bucket
- Storage -> New bucket
- Name: `private-send-files`
- Make it **Private**

### Step 3) Create upload auth user
- Authentication -> Users -> Add user
- Email example: `upload-user@example.com`
- Set your own password (this is upload login password)

### Step 4) Create table + policies
Open SQL Editor and run this:

```sql
create table if not exists public.transfers (
  code text primary key,
  object_path text not null,
  original_name text not null,
  content_type text,
  created_at timestamptz not null default now()
);

alter table public.transfers enable row level security;

-- downloader can find and delete by code
create policy "anon can read transfers"
on public.transfers for select
to anon using (true);

create policy "anon can delete transfers"
on public.transfers for delete
to anon using (true);

-- uploader must be logged-in (authenticated)
create policy "authenticated can insert transfers"
on public.transfers for insert
to authenticated with check (true);

-- storage policies
create policy "authenticated can upload files"
on storage.objects for insert
to authenticated with check (bucket_id = 'private-send-files');

create policy "anon can read files"
on storage.objects for select
to anon using (bucket_id = 'private-send-files');

create policy "anon can delete files"
on storage.objects for delete
to anon using (bucket_id = 'private-send-files');
```

### Step 5) Get Supabase values
Project Settings -> API:
- Project URL
- anon public key

### Step 6) Edit `main.js`
Set these values at the top:

```js
const SUPABASE_URL = 'YOUR_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const SUPABASE_UPLOAD_EMAIL = 'upload-user@example.com';
```

`SUPABASE_UPLOAD_EMAIL` must match the user you created in Step 3.

### Step 7) Run site
Open `index.html` directly or deploy static hosting (GitHub Pages/Netlify/Vercel).

---

## How to change upload password
Change password of upload user in Supabase:
- Authentication -> Users -> select upload user -> reset/update password

No code change needed unless you changed upload email.
