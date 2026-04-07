const loginCard = document.getElementById('loginCard');
const cloudCard = document.getElementById('cloudCard');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');

const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const refreshBtn = document.getElementById('refreshBtn');
const logoutBtn = document.getElementById('logoutBtn');
const cloudStatus = document.getElementById('cloudStatus');
const fileTableBody = document.getElementById('fileTableBody');

function setStatus(message, error = false) {
  cloudStatus.textContent = message;
  cloudStatus.style.color = error ? '#b42318' : '#475467';
}

function formatBytes(size) {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / (1024 ** idx);
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function renderFiles(files = []) {
  fileTableBody.innerHTML = '';

  if (!files.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4">No files yet.</td>';
    fileTableBody.appendChild(row);
    return;
  }

  files.forEach((file) => {
    const row = document.createElement('tr');

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', () => {
      window.location.href = `/api/download?path=${encodeURIComponent(file.name)}`;
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'danger';
    deleteBtn.style.marginLeft = '8px';
    deleteBtn.addEventListener('click', async () => {
      const ok = window.confirm(`Delete ${file.name}?`);
      if (!ok) return;
      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(file.name)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
        setStatus(`Deleted ${file.name}`);
        await loadFiles();
      } catch (err) {
        setStatus(err.message, true);
      }
    });

    const updatedAt = file.updated_at ? new Date(file.updated_at).toLocaleString() : '-';

    row.innerHTML = `
      <td>${file.name}</td>
      <td>${formatBytes(file.size || 0)}</td>
      <td>${updatedAt}</td>
      <td></td>
    `;

    row.children[3].appendChild(downloadBtn);
    row.children[3].appendChild(deleteBtn);
    fileTableBody.appendChild(row);
  });
}

async function loadFiles() {
  const res = await fetch('/api/files');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not load files');
  }
  const data = await res.json();
  renderFiles(data.files || []);
}

async function uploadSelectedFile() {
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    setStatus('Pick a file first.', true);
    return;
  }

  uploadBtn.disabled = true;
  setStatus('Uploading...');

  try {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const contentBase64 = btoa(binary);

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        contentBase64,
        contentType: file.type || 'application/octet-stream'
      })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Upload failed');
    }

    fileInput.value = '';
    setStatus(`Uploaded ${file.name}`);
    await loadFiles();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    uploadBtn.disabled = false;
  }
}

async function showCloud() {
  loginCard.classList.add('hidden');
  cloudCard.classList.remove('hidden');
  await loadFiles();
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

  passwordInput.value = '';
  await showCloud();
});

uploadBtn.addEventListener('click', uploadSelectedFile);
refreshBtn.addEventListener('click', async () => {
  try {
    setStatus('Refreshing...');
    await loadFiles();
    setStatus('Up to date.');
  } catch (err) {
    setStatus(err.message, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  cloudCard.classList.add('hidden');
  loginCard.classList.remove('hidden');
  setStatus('');
});

(async () => {
  try {
    await showCloud();
  } catch {
    loginCard.classList.remove('hidden');
    cloudCard.classList.add('hidden');
  }
})();
