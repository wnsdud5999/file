# Shared Supabase Notes + Files (GitHub Pages compatible)

This website is static (works on GitHub Pages) and uses Supabase for:
- password login,
- multiple notes (create/edit title/content/delete),
- per-note commit history,
- file upload/download/delete per note,
- realtime updates.

---

## Easy setup (step by step)

## 1) In Supabase: create one shared user

1. Open **Authentication → Users**
2. Click **Add user**
3. Email: `sharedemail@email.com` (or your own)
4. Password: `wnsdud5999@` (or your own)

## 2) In Supabase: create a public storage bucket

1. Open **Storage → Buckets**
2. Create bucket name: `note-files`
3. Set bucket to **Public** (so download links work without extra signed URL code)

## 3) In Supabase: run SQL once

Open **SQL Editor** and run:

```sql
create table if not exists public.notes (
  id bigint generated always as identity primary key,
  title text not null default 'Untitled note',
  content text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.commits (
  id bigint generated always as identity primary key,
  note_id bigint not null references public.notes(id) on delete cascade,
  author text,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists public.files (
  id bigint generated always as identity primary key,
  note_id bigint not null references public.notes(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  size_bytes bigint not null default 0,
  uploaded_by text,
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;
alter table public.commits enable row level security;
alter table public.files enable row level security;

-- only logged-in users can read/write
create policy "notes_auth_rw"
on public.notes
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "commits_auth_rw"
on public.commits
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "files_auth_rw"
on public.files
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

-- realtime tables
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.commits;
alter publication supabase_realtime add table public.files;

-- storage policies for bucket note-files
create policy "note_files_auth_read"
on storage.objects
for select
to authenticated
using (bucket_id = 'note-files');

create policy "note_files_auth_insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'note-files');

create policy "note_files_auth_delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'note-files');
```

## 4) Get API values from Supabase

Open **Project Settings → API** and copy:
- Project URL
- anon public key

## 5) Edit `main.js`

Replace these values:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SHARED_EMAIL`

Keep `FILE_BUCKET = 'note-files'` unless you changed bucket name.

## 6) Deploy on GitHub Pages

1. Push to GitHub
2. Open repo **Settings → Pages**
3. Deploy from branch root
4. Open your page URL

---

## What to do on the website

- Enter shared password
- Click **+ New note** to create notes
- Edit note title + text
- Click **Commit changes**
- Upload files in that note
- Click file name to download
- Click **Delete** to remove a file
- Click **Delete note** to remove a note and all its files

---

## Troubleshooting

- **Login failed**: check `SHARED_EMAIL`, password, URL/key.
- **Commit fails**: SQL or RLS policies not applied.
- **Upload fails**: bucket not created or storage policies missing.
