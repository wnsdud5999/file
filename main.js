import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// 1) Put your Supabase project URL and anon key here.
const SUPABASE_URL = 'REPLACE_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'REPLACE_SUPABASE_ANON_KEY';

// 2) Shared login email. User enters password only in UI.
const SHARED_EMAIL = 'sharedemail@email.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginCard = document.getElementById('loginCard');
const editorCard = document.getElementById('editorCard');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');

const editor = document.getElementById('editor');
const authorInput = document.getElementById('authorInput');
const messageInput = document.getElementById('messageInput');
const commitBtn = document.getElementById('commitBtn');
const logoutBtn = document.getElementById('logoutBtn');
const editorStatus = document.getElementById('editorStatus');
const commitList = document.getElementById('commitList');

let channels = [];

function setStatus(text, isError = false) {
  editorStatus.textContent = text;
  editorStatus.style.color = isError ? '#b42318' : '#475467';
}

function showEditor() {
  loginCard.classList.add('hidden');
  editorCard.classList.remove('hidden');
}

function showLogin() {
  editorCard.classList.add('hidden');
  loginCard.classList.remove('hidden');
}

function renderCommits(items = []) {
  commitList.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    const ts = item.created_at ? new Date(item.created_at).toLocaleString() : 'just now';
    li.textContent = `[${ts}] ${item.author || 'anonymous'}: ${item.message || 'Updated shared document'}`;
    commitList.appendChild(li);
  });
}

async function ensureInitialRow() {
  const { data, error } = await supabase
    .from('shared_document')
    .select('id')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const { error: upsertError } = await supabase.from('shared_document').upsert(
      {
        id: 1,
        content: 'Welcome!\\n\\nThis is a shared Supabase document.\\n',
        updated_by: 'system'
      },
      { onConflict: 'id' }
    );
    if (upsertError) throw upsertError;

    const { error: commitError } = await supabase.from('commits').insert({
      author: 'system',
      message: 'Initial document created'
    });
    if (commitError) throw commitError;
  }
}

async function loadDocument() {
  const { data, error } = await supabase
    .from('shared_document')
    .select('content')
    .eq('id', 1)
    .single();

  if (error) throw error;
  editor.value = data.content || '';
}

async function loadCommits() {
  const { data, error } = await supabase
    .from('commits')
    .select('author, message, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  renderCommits(data || []);
}

function clearChannels() {
  channels.forEach((ch) => {
    supabase.removeChannel(ch);
  });
  channels = [];
}

function startRealtime() {
  clearChannels();

  const docChannel = supabase
    .channel('shared_document_changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'shared_document',
        filter: 'id=eq.1'
      },
      async () => {
        await loadDocument();
        setStatus('Document updated by another user.');
      }
    )
    .subscribe();

  const commitsChannel = supabase
    .channel('commit_changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'commits'
      },
      async () => {
        await loadCommits();
      }
    )
    .subscribe();

  channels.push(docChannel, commitsChannel);
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

commitBtn.addEventListener('click', async () => {
  commitBtn.disabled = true;
  setStatus('Committing...');

  try {
    const author = authorInput.value.trim() || 'anonymous';
    const message = messageInput.value.trim() || 'Updated shared document';

    const { error: docError } = await supabase
      .from('shared_document')
      .update({
        content: editor.value,
        updated_by: author,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1);
    if (docError) throw docError;

    const { error: commitError } = await supabase.from('commits').insert({ author, message });
    if (commitError) throw commitError;

    messageInput.value = '';
    setStatus('Committed! Everyone will see this update.');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    commitBtn.disabled = false;
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
    await ensureInitialRow();
    await loadDocument();
    await loadCommits();
    showEditor();
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
    await ensureInitialRow();
    await loadDocument();
    await loadCommits();
    showEditor();
    startRealtime();
    setStatus('Connected.');
  } else {
    showLogin();
  }
})();
