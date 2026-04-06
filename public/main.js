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

let pollTimer;
let currentHash = '';

function setStatus(message, error = false) {
  editorStatus.textContent = message;
  editorStatus.style.color = error ? '#b42318' : '#475467';
}

function renderCommits(commits = []) {
  commitList.innerHTML = '';
  commits.forEach((c) => {
    const li = document.createElement('li');
    const ts = new Date(c.ts).toLocaleString();
    li.textContent = `[${ts}] ${c.author}: ${c.message}`;
    commitList.appendChild(li);
  });
}

async function pollUpdates() {
  const res = await fetch(`/api/poll?hash=${encodeURIComponent(currentHash)}`);
  if (!res.ok) return;
  const data = await res.json();
  currentHash = data.hash || currentHash;
  if (data.changed) {
    editor.value = data.content;
    renderCommits(data.commits || []);
    setStatus('Document updated by another user.');
  }
}

async function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      await pollUpdates();
    } catch {
      // ignore polling hiccups
    }
  }, 2000);
}

async function loadDocument() {
  const res = await fetch('/api/document');
  if (!res.ok) {
    throw new Error('Session expired');
  }
  const data = await res.json();
  editor.value = data.content;
  renderCommits(data.commits);
  currentHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(editor.value)).then((buf) =>
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
  await startPolling();
}

async function showEditor() {
  loginCard.classList.add('hidden');
  editorCard.classList.remove('hidden');
  await loadDocument();
}

loginBtn.addEventListener('click', async () => {
  loginStatus.textContent = '';
  const password = passwordInput.value;

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });

  if (!res.ok) {
    loginStatus.textContent = 'Wrong password.';
    loginStatus.style.color = '#b42318';
    return;
  }

  await showEditor();
});

commitBtn.addEventListener('click', async () => {
  commitBtn.disabled = true;
  setStatus('Committing...');

  try {
    const res = await fetch('/api/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: editor.value,
        author: authorInput.value.trim() || 'anonymous',
        message: messageInput.value.trim() || 'Updated shared document'
      })
    });

    if (!res.ok) {
      throw new Error('Could not commit');
    }

    messageInput.value = '';
    await pollUpdates();
    setStatus('Committed! Everyone will see this update.');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    commitBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  clearInterval(pollTimer);
  await fetch('/api/logout', { method: 'POST' });
  editorCard.classList.add('hidden');
  loginCard.classList.remove('hidden');
  passwordInput.value = '';
  loginStatus.textContent = 'Logged out.';
});

(async () => {
  try {
    await showEditor();
  } catch {
    loginCard.classList.remove('hidden');
    editorCard.classList.add('hidden');
  }
})();
