import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// 1) Put your Supabase project URL and anon key here.
const SUPABASE_URL = 'REPLACE_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'REPLACE_SUPABASE_ANON_KEY';

// 2) Shared login email. User enters password only in UI.
const SHARED_EMAIL = 'sharedemail@email.com';

// 3) Bucket name for uploaded files.
const FILE_BUCKET = 'note-files';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginCard = document.getElementById('loginCard');
const appCard = document.getElementById('appCard');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');

const noteList = document.getElementById('noteList');
const noteTitleInput = document.getElementById('noteTitleInput');
const editor = document.getElementById('editor');
const authorInput = document.getElementById('authorInput');
const messageInput = document.getElementById('messageInput');
const commitBtn = document.getElementById('commitBtn');
const deleteNoteBtn = document.getElementById('deleteNoteBtn');
const logoutBtn = document.getElementById('logoutBtn');
const appStatus = document.getElementById('appStatus');
const commitList = document.getElementById('commitList');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const fileList = document.getElementById('fileList');
const newNoteBtn = document.getElementById('newNoteBtn');

let notes = [];
let selectedNoteId = null;
let channels = [];

function setStatus(text, isError = false) {
  appStatus.textContent = text;
  appStatus.style.color = isError ? '#f97066' : '#98a2b3';
}

function showApp() {
  loginCard.classList.add('hidden');
  appCard.classList.remove('hidden');
}

function showLogin() {
  appCard.classList.add('hidden');
  loginCard.classList.remove('hidden');
}

function clearChannels() {
  channels.forEach((ch) => {
    supabase.removeChannel(ch);
  });
  channels = [];
}

function renderNotes() {
  noteList.innerHTML = '';
  notes.forEach((note) => {
    const li = document.createElement('li');
    li.className = note.id === selectedNoteId ? 'active' : '';

    const titleWrap = document.createElement('div');
    titleWrap.innerHTML = `<strong>${note.title || 'Untitled note'}</strong><small>${new Date(note.updated_at).toLocaleString()}</small>`;

    li.appendChild(titleWrap);
    li.addEventListener('click', async () => {
      await selectNote(note.id);
    });

    noteList.appendChild(li);
  });
}

function renderCommits(items = []) {
  commitList.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    const ts = item.created_at ? new Date(item.created_at).toLocaleString() : 'just now';
    li.textContent = `[${ts}] ${item.author || 'anonymous'}: ${item.message || 'Updated note'}`;
    commitList.appendChild(li);
  });
}

function renderFiles(items = []) {
  fileList.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = item.public_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${item.file_name} (${Math.round((item.size_bytes || 0) / 1024)} KB)`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'secondary';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      const ok = window.confirm(`Delete ${item.file_name}?`);
      if (!ok) return;
      await deleteFile(item);
    });

    li.append(link, deleteBtn);
    fileList.appendChild(li);
  });
}

async function ensureInitialData() {
  const { count, error: countError } = await supabase
    .from('notes')
    .select('id', { head: true, count: 'exact' });
  if (countError) throw countError;

  if (!count) {
    const { data: inserted, error: noteError } = await supabase
      .from('notes')
      .insert({ title: 'Welcome note', content: 'Welcome!\n\nCreate notes, edit text, and upload files.' })
      .select('id')
      .single();
    if (noteError) throw noteError;

    const { error: commitError } = await supabase.from('commits').insert({
      note_id: inserted.id,
      author: 'system',
      message: 'Initial note created'
    });
    if (commitError) throw commitError;
  }
}

async function loadNotes() {
  const { data, error } = await supabase
    .from('notes')
    .select('id, title, content, updated_at, updated_by')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  notes = data || [];

  if (!notes.length) {
    selectedNoteId = null;
    noteTitleInput.value = '';
    editor.value = '';
    renderNotes();
    renderCommits([]);
    renderFiles([]);
    return;
  }

  if (!selectedNoteId || !notes.find((n) => n.id === selectedNoteId)) {
    selectedNoteId = notes[0].id;
  }

  const selected = notes.find((n) => n.id === selectedNoteId);
  noteTitleInput.value = selected?.title || '';
  editor.value = selected?.content || '';
  renderNotes();
}

async function loadCommits() {
  if (!selectedNoteId) {
    renderCommits([]);
    return;
  }

  const { data, error } = await supabase
    .from('commits')
    .select('author, message, created_at')
    .eq('note_id', selectedNoteId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  renderCommits(data || []);
}

async function loadFiles() {
  if (!selectedNoteId) {
    renderFiles([]);
    return;
  }

  const { data, error } = await supabase
    .from('files')
    .select('id, file_name, storage_path, size_bytes')
    .eq('note_id', selectedNoteId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const items = (data || []).map((item) => {
    const { data: pub } = supabase.storage.from(FILE_BUCKET).getPublicUrl(item.storage_path);
    return {
      ...item,
      public_url: pub.publicUrl
    };
  });

  renderFiles(items);
}

async function selectNote(noteId) {
  selectedNoteId = noteId;
  const selected = notes.find((n) => n.id === selectedNoteId);
  noteTitleInput.value = selected?.title || '';
  editor.value = selected?.content || '';
  renderNotes();
  await loadCommits();
  await loadFiles();
}

async function createNote() {
  const title = window.prompt('New note title:', 'New note');
  if (!title) return;

  const { data, error } = await supabase
    .from('notes')
    .insert({ title: title.trim(), content: '' })
    .select('id')
    .single();
  if (error) throw error;

  const { error: commitError } = await supabase.from('commits').insert({
    note_id: data.id,
    author: authorInput.value.trim() || 'anonymous',
    message: `Created note "${title.trim()}"`
  });
  if (commitError) throw commitError;

  await loadNotes();
  await selectNote(data.id);
  setStatus('New note created.');
}

async function deleteCurrentNote() {
  if (!selectedNoteId) return;
  const selected = notes.find((n) => n.id === selectedNoteId);
  const ok = window.confirm(`Delete note "${selected?.title || 'Untitled note'}"?`);
  if (!ok) return;

  const { data: filesForNote, error: filesQueryError } = await supabase
    .from('files')
    .select('storage_path')
    .eq('note_id', selectedNoteId);
  if (filesQueryError) throw filesQueryError;

  const storagePaths = (filesForNote || []).map((f) => f.storage_path).filter(Boolean);
  if (storagePaths.length) {
    const { error: storageDeleteError } = await supabase.storage.from(FILE_BUCKET).remove(storagePaths);
    if (storageDeleteError) throw storageDeleteError;
  }

  const { error: fileMetaError } = await supabase.from('files').delete().eq('note_id', selectedNoteId);
  if (fileMetaError) throw fileMetaError;

  const { error: commitDeleteError } = await supabase.from('commits').delete().eq('note_id', selectedNoteId);
  if (commitDeleteError) throw commitDeleteError;

  const { error: noteDeleteError } = await supabase.from('notes').delete().eq('id', selectedNoteId);
  if (noteDeleteError) throw noteDeleteError;

  selectedNoteId = null;
  await loadNotes();
  if (notes[0]) {
    await selectNote(notes[0].id);
  }
  setStatus('Note deleted.');
}

async function commitCurrentNote() {
  if (!selectedNoteId) {
    setStatus('Select a note first.', true);
    return;
  }

  commitBtn.disabled = true;
  setStatus('Committing note...');

  try {
    const author = authorInput.value.trim() || 'anonymous';
    const message = messageInput.value.trim() || 'Updated note';

    const { error: noteError } = await supabase
      .from('notes')
      .update({
        title: noteTitleInput.value.trim() || 'Untitled note',
        content: editor.value,
        updated_by: author,
        updated_at: new Date().toISOString()
      })
      .eq('id', selectedNoteId);
    if (noteError) throw noteError;

    const { error: commitError } = await supabase.from('commits').insert({
      note_id: selectedNoteId,
      author,
      message
    });
    if (commitError) throw commitError;

    messageInput.value = '';
    setStatus('Committed! Everyone will see this note update.');
    await loadNotes();
    await loadCommits();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    commitBtn.disabled = false;
  }
}

async function uploadFileForNote() {
  if (!selectedNoteId) {
    setStatus('Select a note first.', true);
    return;
  }

  const file = fileInput.files?.[0];
  if (!file) {
    setStatus('Choose a file first.', true);
    return;
  }

  uploadBtn.disabled = true;
  setStatus('Uploading file...');

  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${selectedNoteId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage.from(FILE_BUCKET).upload(storagePath, file, {
      upsert: false
    });
    if (uploadError) throw uploadError;

    const { error: metaError } = await supabase.from('files').insert({
      note_id: selectedNoteId,
      file_name: file.name,
      storage_path: storagePath,
      size_bytes: file.size,
      uploaded_by: authorInput.value.trim() || 'anonymous'
    });
    if (metaError) throw metaError;

    fileInput.value = '';
    await loadFiles();
    setStatus('File uploaded.');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    uploadBtn.disabled = false;
  }
}

async function deleteFile(item) {
  setStatus('Deleting file...');

  try {
    const { error: storageError } = await supabase.storage.from(FILE_BUCKET).remove([item.storage_path]);
    if (storageError) throw storageError;

    const { error: dbError } = await supabase.from('files').delete().eq('id', item.id);
    if (dbError) throw dbError;

    await loadFiles();
    setStatus('File deleted.');
  } catch (err) {
    setStatus(err.message, true);
  }
}

function startRealtime() {
  clearChannels();

  const notesChannel = supabase
    .channel('notes_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notes' },
      async () => {
        await loadNotes();
      }
    )
    .subscribe();

  const commitsChannel = supabase
    .channel('commits_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'commits' },
      async () => {
        await loadCommits();
      }
    )
    .subscribe();

  const filesChannel = supabase
    .channel('files_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'files' },
      async () => {
        await loadFiles();
      }
    )
    .subscribe();

  channels.push(notesChannel, commitsChannel, filesChannel);
}

loginBtn.addEventListener('click', async () => {
  loginStatus.textContent = '';

  const password = passwordInput.value;
  const { error } = await supabase.auth.signInWithPassword({
    email: SHARED_EMAIL,
    password
  });

  if (error) {
    loginStatus.textContent = `Login failed: ${error.message}`;
    loginStatus.style.color = '#b42318';
    return;
  }

  passwordInput.value = '';
});

newNoteBtn.addEventListener('click', async () => {
  try {
    await createNote();
  } catch (err) {
    setStatus(err.message, true);
  }
});

commitBtn.addEventListener('click', commitCurrentNote);
uploadBtn.addEventListener('click', uploadFileForNote);
deleteNoteBtn.addEventListener('click', async () => {
  try {
    await deleteCurrentNote();
  } catch (err) {
    setStatus(err.message, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  if (!session?.user) {
    clearChannels();
    showLogin();
    return;
  }

  try {
    await ensureInitialData();
    await loadNotes();
    if (notes[0]) await selectNote(selectedNoteId || notes[0].id);
    showApp();
    startRealtime();
    setStatus('Connected.');
  } catch (err) {
    showLogin();
    loginStatus.textContent = `Setup error: ${err.message}`;
    loginStatus.style.color = '#b42318';
  }
});

(async () => {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    await ensureInitialData();
    await loadNotes();
    if (notes[0]) await selectNote(selectedNoteId || notes[0].id);
    showApp();
    startRealtime();
    setStatus('Connected.');
  } else {
    showLogin();
  }
})();
