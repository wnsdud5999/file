# Private Send (Supabase only)

This app is fully client-side and uses only Supabase.

## What changed
- Normal user gets a short code and downloader can use it **one time only**.
- After first download, that code cannot be reused.
- File is kept for up to **7 days** for admin log access.
- Admin can view transfer logs and download files within 7 days.

## Accounts you need in Supabase Auth
Create these users in **Authentication -> Users**:
- Upload user email (example): `upload-user@example.com`
- Admin user email: `admin@email.com`

## Storage setup
Create private bucket:
- Name: `private-send-files`
- Visibility: private

## SQL setup (run all at once)
Open SQL Editor and run this whole script:

If you get `column "code_used_at" does not exist`, your table is from an older version. The script below now repairs old tables first.

```sql
create table if not exists public.transfers (
  code text primary key,
  object_path text not null unique,
  original_name text not null,
  content_type text,
  created_at timestamptz not null default now(),
  code_used_at timestamptz
);

-- important: if transfers table already existed from old setup,
-- add missing columns/constraints so new policies/functions work.
alter table public.transfers
  add column if not exists object_path text,
  add column if not exists original_name text,
  add column if not exists content_type text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists code_used_at timestamptz;

alter table public.transfers alter column object_path set not null;
alter table public.transfers alter column original_name set not null;
alter table public.transfers alter column created_at set not null;

create unique index if not exists transfers_object_path_key on public.transfers (object_path);

alter table public.transfers enable row level security;

-- rerun-safe policy cleanup
-- table policies
 drop policy if exists "anon can read active transfers" on public.transfers;
 drop policy if exists "anon can delete expired transfers" on public.transfers;
 drop policy if exists "admin can view logs" on public.transfers;
 drop policy if exists "admin can delete logs" on public.transfers;

-- storage policies
 drop policy if exists "authenticated can upload files" on storage.objects;
 drop policy if exists "anon can read files" on storage.objects;
 drop policy if exists "anon can delete expired files" on storage.objects;
 drop policy if exists "admin can read files" on storage.objects;
 drop policy if exists "admin can delete files" on storage.objects;

-- active code lookup only (code not consumed + not older than 7 days)
create policy "anon can read active transfers"
on public.transfers for select
to anon using (
  code_used_at is null
  and created_at > now() - interval '7 days'
);

-- allow anon cleanup for expired rows only
create policy "anon can delete expired transfers"
on public.transfers for delete
to anon using (
  created_at <= now() - interval '7 days'
);

-- admin can view/delete all transfer logs
create policy "admin can view logs"
on public.transfers for select
to authenticated using (
  auth.jwt() ->> 'email' = 'admin@email.com'
);

create policy "admin can delete logs"
on public.transfers for delete
to authenticated using (
  auth.jwt() ->> 'email' = 'admin@email.com'
);

-- upload account can upload objects
create policy "authenticated can upload files"
on storage.objects for insert
to authenticated with check (
  bucket_id = 'private-send-files'
);

-- anon can read from bucket (download side)
create policy "anon can read files"
on storage.objects for select
to anon using (
  bucket_id = 'private-send-files'
);

-- anon can delete only expired files from bucket
create policy "anon can delete expired files"
on storage.objects for delete
to anon using (
  bucket_id = 'private-send-files'
  and created_at <= now() - interval '7 days'
);

-- admin can read/delete any file in bucket
create policy "admin can read files"
on storage.objects for select
to authenticated using (
  bucket_id = 'private-send-files'
  and auth.jwt() ->> 'email' = 'admin@email.com'
);

create policy "admin can delete files"
on storage.objects for delete
to authenticated using (
  bucket_id = 'private-send-files'
  and auth.jwt() ->> 'email' = 'admin@email.com'
);

-- upload record creation (authenticated uploader)
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

  insert into public.transfers (
    code,
    object_path,
    original_name,
    content_type,
    created_at,
    code_used_at
  )
  values (
    p_code,
    p_object_path,
    p_original_name,
    p_content_type,
    p_created_at,
    null
  );
end;
$$;

grant execute on function public.create_transfer(text, text, text, text, timestamptz) to authenticated;

-- one-time consume code for downloader (anon)
create or replace function public.consume_transfer(p_code text)
returns table (
  code text,
  object_path text,
  original_name text,
  content_type text,
  created_at timestamptz,
  code_used_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row public.transfers%rowtype;
begin
  update public.transfers
  set code_used_at = now()
  where transfers.code = p_code
    and transfers.code_used_at is null
    and transfers.created_at > now() - interval '7 days'
  returning * into found_row;

  if found_row is null then
    return;
  end if;

  code := found_row.code;
  object_path := found_row.object_path;
  original_name := found_row.original_name;
  content_type := found_row.content_type;
  created_at := found_row.created_at;
  code_used_at := found_row.code_used_at;
  return next;
end;
$$;

grant execute on function public.consume_transfer(text) to anon;
```

## App config in `main.js`

```js
const SUPABASE_URL = 'YOUR_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';
const SUPABASE_UPLOAD_EMAIL = 'upload-user@example.com';
const SUPABASE_ADMIN_EMAIL = 'admin@email.com';
```

## How to use
- Side A: enter code and download.
- Side B upload login: enter upload user password in the single input and press keyboard Enter (or click Enter button).
- Side B admin login: type `admin` and submit once, then type admin password in the same input and submit again.
- If you accidentally entered admin mode, type `admin` and submit again to cancel admin mode.

## Notes
- Upload max size is 50 MB.
- You can upload multiple files in one batch (each file still max 50 MB).
- Selected files appear in a queue under upload area; click `×` to remove/cancel before upload.
- New codes are 3 digits.
- Legacy 6-digit code input is still accepted.
