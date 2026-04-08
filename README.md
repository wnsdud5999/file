# Private Send (Supabase only, no custom server)

If you saw this error on upload:
`new row violates row-level security policy`
that means SQL setup is incomplete.

Use the exact SQL below (copy-paste all), then upload works.

If SQL stops with "policy already exists", the rest of the script does **not** run.
That can leave setup half-finished (for example function/grant not created).

---

## What this does
1. Upload user logs in with Supabase Auth (email/password)
2. Upload file (max 50 MB)
3. Get random 6-digit code
4. Downloader enters code
5. File is downloaded once, then deleted

---

## Setup (important: do in this order)

### 1) Create Supabase project

### 2) Create private bucket
- Storage -> New bucket
- Name: `private-send-files`
- Private bucket

### 3) Create upload auth user
- Authentication -> Users -> Add user
- Example email: `upload-user@example.com`
- Set password (this password is used on upload login)

### 4) Run SQL (copy all)
Open SQL Editor and run:

```sql
create table if not exists public.transfers (
  code text primary key,
  object_path text not null,
  original_name text not null,
  content_type text,
  created_at timestamptz not null default now()
);

alter table public.transfers enable row level security;

-- rerun-safe: drop old policies first (important)
drop policy if exists "anon can read transfers" on public.transfers;
drop policy if exists "anon can delete transfers" on public.transfers;
drop policy if exists "authenticated can upload files" on storage.objects;
drop policy if exists "anon can read files" on storage.objects;
drop policy if exists "anon can delete files" on storage.objects;

-- allow download side (anon) to read/delete by code
create policy "anon can read transfers"
on public.transfers for select
to anon using (true);

create policy "anon can delete transfers"
on public.transfers for delete
to anon using (true);

-- storage rules
create policy "authenticated can upload files"
on storage.objects for insert
to authenticated with check (bucket_id = 'private-send-files');

create policy "anon can read files"
on storage.objects for select
to anon using (bucket_id = 'private-send-files');

create policy "anon can delete files"
on storage.objects for delete
to anon using (bucket_id = 'private-send-files');

-- function used by app to create transfer row safely
create or replace function public.create_transfer(
  p_code text,
  p_object_path text,
  p_original_name text,
  p_content_type text,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'not authenticated';
  end if;

  insert into public.transfers (code, object_path, original_name, content_type, created_at)
  values (p_code, p_object_path, p_original_name, p_content_type, p_created_at);
end;
$$;

grant execute on function public.create_transfer(text, text, text, text, timestamptz) to authenticated;
```

### 5) Get API values
Project Settings -> API:
- Project URL
- anon public key

### 6) Edit `main.js`

```js
const SUPABASE_URL = 'YOUR_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const SUPABASE_UPLOAD_EMAIL = 'upload-user@example.com';
```

### 7) Run site
Open `index.html` (or deploy static hosting).

---

## Change upload password
Supabase -> Authentication -> Users -> choose upload user -> reset password.

No code change needed unless upload email changes.
