# Shared Supabase Note (GitHub Pages compatible)

This website is static (works on GitHub Pages) and uses Supabase for:
- password login,
- shared text storage,
- realtime updates,
- commit history.

---

## Very easy setup (follow in order)

## 1) In Supabase: create one shared user

- Open **Authentication > Users**
- Click **Add user**
- Email: `sharedemail@email.com` (or your own)
- Password: `wnsdud5999@` (or your own)

## 2) In Supabase: run SQL once

Open **SQL Editor** and run this:

```sql
create table if not exists public.shared_document (
  id integer primary key,
  content text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.commits (
  id bigint generated always as identity primary key,
  author text,
  message text,
  created_at timestamptz not null default now()
);

alter table public.shared_document enable row level security;
alter table public.commits enable row level security;

-- only logged-in users can read/write
create policy "shared_document_auth_rw"
on public.shared_document
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "commits_auth_rw"
on public.commits
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

-- realtime
alter publication supabase_realtime add table public.shared_document;
alter publication supabase_realtime add table public.commits;
```

## 3) Get API values from Supabase

Open **Project Settings > API** and copy:
- Project URL
- anon public key

## 4) Edit `main.js`

Replace these values:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SHARED_EMAIL`

## 5) Deploy on GitHub Pages

- Push to GitHub
- Repo **Settings > Pages**
- Deploy from branch root
- Open your page URL

---

## Notes

- This app is shared: anyone with that password can edit.
- If login fails, usually `SHARED_EMAIL` or key/url is wrong.
- If commits fail, SQL/policies were not applied yet.
