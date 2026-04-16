import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ====== CHANGE THESE 4 VALUES ======
const SUPABASE_URL = 'https://pnyimurfileqbesoasdl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBueWltdXJmaWxlcWJlc29hc2RsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDczMzAsImV4cCI6MjA5MTAyMzMzMH0.HCj5kpgu0D5b4-b02OkejdJrLdo4XX-ZrfzJ8ceW7UY';
const SUPABASE_UPLOAD_EMAIL = 'upload-user@example.com';
const SUPABASE_ADMIN_EMAIL = 'admin@email.com';
// ===================================

const BUCKET = 'private-send-files';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CODE_LENGTH = 3;
const LEGACY_CODE_LENGTH = 6;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

const downloadCodeInput = document.getElementById('downloadCodeInput');
const downloadBtn = document.getElementById('downloadBtn');
const downloadStatus = document.getElementById('downloadStatus');

const uploadLoginPasswordInput = document.getElementById('uploadLoginPasswordInput');
const uploadLoginBtn = document.getElementById('uploadLoginBtn');
const uploadLogoutBtn = document.getElementById('uploadLogoutBtn');
const uploadAuthStatus = document.getElementById('uploadAuthStatus');

const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const selectedFileName = document.getElementById('selectedFileName');
const uploadBtn = document.getElementById('uploadBtn');
const uploadActions = document.getElementById('uploadActions');
const uploadHint = document.getElementById('uploadHint');
const uploadStatus = document.getElementById('uploadStatus');
const generatedCode = document.getElementById('generatedCode');

const adminPanel = document.getElementById('adminPanel');
const adminRefreshBtn = document.getElementById('adminRefreshBtn');
const adminLogStatus = document.getElementById('adminLogStatus');
const adminLogList = document.getElementById('adminLogList');

let uploadUser = null;
let adminUser = null;
let selectedUploadFile = null;
let awaitingAdminPassword = false;

function setStatus(target, message, error = false) {
  if (!target) return;
  target.textContent = message;
  target.style.color = error ? '#ff6b6b' : '#b8b8c5';
}

function updateSelectedFileName(file) {
  if (!selectedFileName) return;
  selectedFileName.textContent = file ? cleanFileName(file.name) : 'No file selected';
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, LEGACY_CODE_LENGTH);
}

function randomCode() {
  return String(Math.floor(Math.random() * 1_000)).padStart(CODE_LENGTH, '0');
}

function cleanFileName(name) {
  return String(name || 'file.bin').replace(/[^a-zA-Z0-9._\- ()]/g, '_');
}

function isFresh(createdAt) {
  const age = Date.now() - new Date(createdAt).getTime();
  return Number.isFinite(age) && age <= RETENTION_MS;
}

function triggerDownload(blobLike, filename, contentType) {
  const blob = new Blob([blobLike], { type: contentType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function refreshUploadAuthUI() {
  const loggedInUploader = Boolean(uploadUser);
  const loggedInAdmin = Boolean(adminUser);

  if (uploadBtn) uploadBtn.disabled = !loggedInUploader;
  if (fileInput) fileInput.disabled = !loggedInUploader;

  if (uploadLogoutBtn) uploadLogoutBtn.style.display = loggedInUploader || loggedInAdmin ? 'inline-block' : 'none';
  if (uploadActions) uploadActions.classList.toggle('hidden', !loggedInUploader);
  if (uploadHint) uploadHint.style.display = loggedInUploader || loggedInAdmin ? 'none' : 'block';
  if (adminPanel) adminPanel.classList.toggle('hidden', !loggedInAdmin);

  if (loggedInUploader) {
    setStatus(uploadAuthStatus, `Access active: ${uploadUser.email}`);
  } else if (loggedInAdmin) {
    setStatus(uploadAuthStatus, `Admin active: ${adminUser.email}`);
  } else {
    setStatus(uploadAuthStatus, 'Access required.');
  }

}

async function createUniqueCode() {
  return randomCode();
}

async function loginForUploadOrAdmin() {
  if (SUPABASE_URL.includes('REPLACE_') || SUPABASE_ANON_KEY.includes('REPLACE_')) {
    setStatus(uploadAuthStatus, 'Please set SUPABASE_URL + SUPABASE_ANON_KEY in main.js.', true);
    return;
  }

  uploadLoginBtn.disabled = true;

  try {
    const authValue = String(uploadLoginPasswordInput.value || '');

    if (awaitingAdminPassword) {
      if (authValue.trim().toLowerCase() === 'admin') {
        awaitingAdminPassword = false;
        uploadLoginPasswordInput.value = '';
        setStatus(uploadAuthStatus, 'Admin mode canceled. Enter upload password or type admin again.');
        return;
      }

      if (!authValue) {
        setStatus(uploadAuthStatus, 'Admin password needed.', true);
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: SUPABASE_ADMIN_EMAIL,
        password: authValue
      });

      if (error) throw error;
      adminUser = data.user;
      uploadUser = null;
      uploadLoginPasswordInput.value = '';
      awaitingAdminPassword = false;
      refreshUploadAuthUI();
      setStatus(uploadStatus, 'Admin access granted.');
      await loadAdminLogs();
      return;
    }

    if (authValue.trim().toLowerCase() === 'admin') {
      awaitingAdminPassword = true;
      uploadLoginPasswordInput.value = '';
      setStatus(uploadAuthStatus, 'Admin mode. Enter admin password, then press Enter again.');
      return;
    }

    const password = authValue;
    if (!password) {
      setStatus(uploadAuthStatus, 'Enter upload account password.', true);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: SUPABASE_UPLOAD_EMAIL,
      password
    });

    if (error) throw error;
    uploadUser = data.user;
    adminUser = null;
    uploadLoginPasswordInput.value = '';
    awaitingAdminPassword = false;
    refreshUploadAuthUI();
    setStatus(uploadStatus, 'Access granted.');
  } catch (error) {
    setStatus(uploadAuthStatus, error.message || 'Login failed.', true);
  } finally {
    uploadLoginBtn.disabled = false;
  }
  throw new Error('Could not generate code. Try again.');
}

async function logoutUpload() {
  await supabase.auth.signOut();
  uploadUser = null;
  adminUser = null;
  selectedUploadFile = null;
  awaitingAdminPassword = false;
  fileInput.value = '';
  updateSelectedFileName(null);
  uploadLoginPasswordInput.value = '';
  if (adminLogList) adminLogList.innerHTML = '';
  setStatus(adminLogStatus, '');
  refreshUploadAuthUI();
  setStatus(uploadStatus, 'Access closed.');
}

async function uploadFile() {
  const file = selectedUploadFile || (fileInput.files && fileInput.files[0]);

  if (!uploadUser) {
    setStatus(uploadStatus, 'Upload access required first.', true);
    return;
  }

  if (!file) {
    setStatus(uploadStatus, 'Select an item first.', true);
    return;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    setStatus(uploadStatus, 'Item too large (max 50 MB).', true);
    return;
  }

  uploadBtn.disabled = true;
  generatedCode.textContent = '';
  setStatus(uploadStatus, 'Working...');

  try {
    const objectPath = `${crypto.randomUUID()}-${cleanFileName(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, file, { upsert: false });

    if (uploadError) throw uploadError;

    const { data: userInfo } = await supabase.auth.getUser();
    if (!userInfo.user) {
      await supabase.auth.signOut();
      uploadUser = null;
      refreshUploadAuthUI();
      throw new Error('Session expired. Re-enter access.');
    }

    let code = '';
    let insertError = null;

    for (let i = 0; i < 30; i += 1) {
      code = await createUniqueCode();

      const { error } = await supabase.rpc('create_transfer', {
        p_code: code,
        p_object_path: objectPath,
        p_original_name: cleanFileName(file.name),
        p_content_type: file.type || 'application/octet-stream',
        p_created_at: new Date().toISOString()
      });

      if (!error) {
        insertError = null;
        break;
      }

      insertError = error;
      const msg = String(error.message || '').toLowerCase();
      const isDuplicate = msg.includes('duplicate key') || msg.includes('already exists');
      if (!isDuplicate) break;
    }

    if (insertError) {
      await supabase.storage.from(BUCKET).remove([objectPath]);
      throw insertError;
    }

    setStatus(uploadStatus, 'Done. Use this value:');
    generatedCode.textContent = code;
    fileInput.value = '';
    selectedUploadFile = null;
    updateSelectedFileName(null);
  } catch (error) {
    setStatus(uploadStatus, error.message || 'Action failed', true);
  } finally {
    uploadBtn.disabled = false;
  }
}

async function downloadWithCode() {
  const code = onlyDigits(downloadCodeInput.value);
  downloadCodeInput.value = code;

  if (SUPABASE_URL.includes('REPLACE_') || SUPABASE_ANON_KEY.includes('REPLACE_')) {
    setStatus(downloadStatus, 'Please set SUPABASE_URL + SUPABASE_ANON_KEY in main.js.', true);
    return;
  }
}

  if (code.length !== CODE_LENGTH && code.length !== LEGACY_CODE_LENGTH) {
    setStatus(downloadStatus, `Value must be ${CODE_LENGTH} or ${LEGACY_CODE_LENGTH} digits.`, true);
    return;
  }
}

  downloadBtn.disabled = true;
  setStatus(downloadStatus, 'Checking...');

  try {
    const { data: consumed, error: consumeError } = await supabasePublic.rpc('consume_transfer', {
      p_code: code
    });

    if (consumeError) throw consumeError;
    const transfer = Array.isArray(consumed) ? consumed[0] : consumed;

    if (!transfer) {
      throw new Error('Value not found or already used.');
    }

    if (!isFresh(transfer.created_at)) {
      await supabasePublic.storage.from(BUCKET).remove([transfer.object_path]);
      await supabasePublic.from('transfers').delete().eq('object_path', transfer.object_path);
      throw new Error('Value expired.');
    }

    const { data: fileData, error: downloadError } = await supabasePublic.storage
      .from(BUCKET)
      .download(transfer.object_path);

    if (downloadError) throw downloadError;

    triggerDownload(fileData, transfer.original_name || `download-${code}`, transfer.content_type);

    setStatus(downloadStatus, 'Completed. Value is now invalid.');
    downloadCodeInput.value = '';
  } catch (error) {
    setStatus(downloadStatus, error.message || 'Action failed', true);
  } finally {
    downloadBtn.disabled = false;
  }
}

async function adminDownload(objectPath, originalName, contentType) {
  if (!adminUser) {
    setStatus(adminLogStatus, 'Admin access required.', true);
    return;
  }

  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
    if (error) throw error;
    triggerDownload(data, originalName || 'file.bin', contentType);
  } catch (error) {
    setStatus(adminLogStatus, error.message || 'Admin download failed.', true);
  }
}

function renderAdminRows(rows) {
  adminLogList.innerHTML = '';

  if (!rows.length) {
    setStatus(adminLogStatus, 'No transfer logs found.');
    return;
  }

  const freshRows = rows.filter((row) => isFresh(row.created_at));
  if (!freshRows.length) {
    setStatus(adminLogStatus, 'No logs in last 7 days.');
    return;
  }

  setStatus(adminLogStatus, `Showing ${freshRows.length} item(s), last 7 days.`);

  freshRows.forEach((row) => {
    const entry = document.createElement('div');
    entry.className = 'admin-log-item';

    const top = document.createElement('div');
    top.className = 'admin-log-head';
    const codeState = row.code_used_at ? 'used' : 'active';
    top.textContent = `${row.original_name} · ${codeState}`;

    const meta = document.createElement('div');
    meta.className = 'admin-log-meta';
    meta.textContent = `Created: ${new Date(row.created_at).toLocaleString()}`;

    const rowActions = document.createElement('div');
    rowActions.className = 'admin-log-actions';
    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.textContent = 'Download';
    dlBtn.addEventListener('click', () => {
      adminDownload(row.object_path, row.original_name, row.content_type);
    });

    rowActions.appendChild(dlBtn);

    entry.appendChild(top);
    entry.appendChild(meta);
    entry.appendChild(rowActions);
    adminLogList.appendChild(entry);
  });
}

async function loadAdminLogs() {
  if (!adminUser) return;

  adminRefreshBtn.disabled = true;
  setStatus(adminLogStatus, 'Loading...');

  try {
    const { data: rows, error } = await supabase
      .from('transfers')
      .select('code, object_path, original_name, content_type, created_at, code_used_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const expiredRows = rows.filter((row) => !isFresh(row.created_at));
    for (const row of expiredRows) {
      await supabase.storage.from(BUCKET).remove([row.object_path]);
      await supabase.from('transfers').delete().eq('object_path', row.object_path);
    }

    const activeRows = rows.filter((row) => isFresh(row.created_at));
    renderAdminRows(activeRows);
  } catch (error) {
    setStatus(adminLogStatus, error.message || 'Could not load admin logs.', true);
  } finally {
    adminRefreshBtn.disabled = false;
  }
}

if (downloadCodeInput) {
  downloadCodeInput.addEventListener('input', () => {
    downloadCodeInput.value = onlyDigits(downloadCodeInput.value);
  });
}

if (uploadLoginBtn) uploadLoginBtn.addEventListener('click', loginForUploadOrAdmin);
if (uploadLoginPasswordInput) {
  uploadLoginPasswordInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    loginForUploadOrAdmin();
  });
}
if (uploadLogoutBtn) uploadLogoutBtn.addEventListener('click', logoutUpload);
if (downloadBtn) downloadBtn.addEventListener('click', downloadWithCode);
if (uploadBtn) uploadBtn.addEventListener('click', uploadFile);
if (adminRefreshBtn) adminRefreshBtn.addEventListener('click', loadAdminLogs);

if (fileInput) {
  fileInput.addEventListener('change', () => {
    selectedUploadFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    updateSelectedFileName(selectedUploadFile);
  });
}

function bindDropZone() {
  if (!dropZone) return;

  const prevent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, prevent);
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      dropZone.style.borderColor = '#9a9aaa';
      dropZone.style.background = '#2a2a30';
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      dropZone.style.borderColor = '#62626d';
      dropZone.style.background = 'transparent';
    });
  });

  dropZone.addEventListener('drop', (event) => {
    if (!uploadUser) return;
    const droppedFile = event.dataTransfer?.files?.[0] || null;
    if (!droppedFile) return;
    selectedUploadFile = droppedFile;
    updateSelectedFileName(droppedFile);
    setStatus(uploadStatus, 'Item selected.');
  });
}

(async () => {
  if (!downloadCodeInput || !downloadBtn || !uploadLoginPasswordInput || !uploadLoginBtn) {
    console.error('UI wiring failed: required elements are missing.');
    return;
  }

  const { data } = await supabase.auth.getSession();
  const user = data.session?.user || null;

  if (user && user.email === SUPABASE_UPLOAD_EMAIL) {
    uploadUser = user;
  } else if (user && user.email === SUPABASE_ADMIN_EMAIL) {
    adminUser = user;
  }

  refreshUploadAuthUI();
  updateSelectedFileName(null);
  bindDropZone();

  if (adminUser) {
    await loadAdminLogs();
  }
})();
