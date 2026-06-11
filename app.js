async function loadSupabaseCreateClient() {
  const cdnCandidates = [
    'https://esm.sh/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
    'https://unpkg.com/@supabase/supabase-js@2/dist/module/index.js'
  ];

  for (const url of cdnCandidates) {
    try {
      const mod = await import(url);
      if (typeof mod.createClient === 'function') return mod.createClient;
    } catch {
      // try next CDN
    }
  }

  throw new Error('Could not load Supabase SDK from CDN. Check your network/firewall and try again.');
}

const createClient = await loadSupabaseCreateClient();

const APP_CONFIG = globalThis.PRIVATE_SEND_CONFIG || {};

// ====== CHANGE THESE 4 VALUES ======
const SUPABASE_URL = APP_CONFIG.SUPABASE_URL || 'https://pnyimurfileqbesoasdl.supabase.co';
const SUPABASE_ANON_KEY = APP_CONFIG.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBueWltdXJmaWxlcWJlc29hc2RsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDczMzAsImV4cCI6MjA5MTAyMzMzMH0.HCj5kpgu0D5b4-b02OkejdJrLdo4XX-ZrfzJ8ceW7UY';
const SUPABASE_UPLOAD_EMAIL = APP_CONFIG.SUPABASE_UPLOAD_EMAIL || 'upload-user@example.com';
const SUPABASE_ADMIN_EMAIL = APP_CONFIG.SUPABASE_ADMIN_EMAIL || 'admin@email.com';
// ===================================

const BUCKET = 'private-send-files';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const SPLIT_PART_BYTES = 50 * 1024 * 1024; // 50MB per part
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CODE_LENGTH = 3;
const LEGACY_CODE_LENGTH = 6;

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const hasValidSupabaseConfig = isValidHttpUrl(SUPABASE_URL) && /^eyJ/.test(String(SUPABASE_ANON_KEY || ''));
const CONFIG_ERROR_MESSAGE = hasValidSupabaseConfig
  ? ''
  : 'Invalid Supabase config. Set valid SUPABASE_URL (http/https) and SUPABASE_ANON_KEY first.';

const supabase = hasValidSupabaseConfig ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const supabasePublic = hasValidSupabaseConfig
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    })
  : null;

const downloadCodeInput = document.getElementById('downloadCodeInput');
const downloadCodeRows = document.getElementById('downloadCodeRows');
const addDownloadCodeBtn = document.getElementById('addDownloadCodeBtn');
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
const uploadQueue = document.getElementById('uploadQueue');
const clearQueueBtn = document.getElementById('clearQueueBtn');

const adminPanel = document.getElementById('adminPanel');
const adminRefreshBtn = document.getElementById('adminRefreshBtn');
const adminLogStatus = document.getElementById('adminLogStatus');
const adminLogList = document.getElementById('adminLogList');

let uploadUser = null;
let adminUser = null;
let selectedUploadFiles = [];
let uploadFileQueue = [];
let awaitingAdminPassword = false;


function setStatus(target, message, error = false) {
  if (!target) return;
  target.textContent = message;
  target.style.color = error ? '#ff6b6b' : '#b8b8c5';
}

function ensureSupabaseReady(statusTarget = null) {
  if (hasValidSupabaseConfig && supabase && supabasePublic) return true;
  if (statusTarget) setStatus(statusTarget, CONFIG_ERROR_MESSAGE, true);
  return false;
}

function updateSelectedFileName(files) {
  if (!selectedFileName) return;
  if (!files || !files.length) {
    selectedFileName.textContent = 'No files selected';
    return;
  }

  if (files.length === 1) {
    selectedFileName.textContent = cleanFileName(files[0].name);
    return;
  }

  selectedFileName.textContent = `${files.length} files selected`;
}

function makeQueueId(file) {
  return `${file.name}__${file.size}__${file.lastModified}__${crypto.randomUUID()}`;
}

function queueSummary(item) {
  const statusLabel = {
    queued: 'Queued',
    uploading: `Uploading ${item.progress || 0}%`,
    uploaded: `Uploaded (code: ${item.code || '-'})`,
    failed: `Failed${item.error ? `: ${item.error}` : ''}`
  };
  return statusLabel[item.status] || 'Queued';
}

function renderUploadQueue() {
  if (!uploadQueue) return;
  uploadQueue.innerHTML = '';
  if (clearQueueBtn) clearQueueBtn.style.display = uploadFileQueue.length ? 'inline-block' : 'none';

  for (const item of uploadFileQueue) {
    const row = document.createElement('div');
    row.className = 'upload-queue-item';

    const name = document.createElement('span');
    name.textContent = cleanFileName(item.file.name);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'queue-remove-btn';
    removeBtn.dataset.queueId = item.id;
    removeBtn.dataset.action = 'remove';
    removeBtn.textContent = '×';

    const status = document.createElement('span');
    status.className = 'upload-queue-status';
    status.textContent = queueSummary(item);

    const actions = document.createElement('div');
    actions.className = 'upload-queue-actions';

    if (item.status === 'failed') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'queue-retry-btn';
      retryBtn.dataset.queueId = item.id;
      retryBtn.dataset.action = 'retry';
      retryBtn.textContent = 'Retry';
      actions.appendChild(retryBtn);
    }

    if (item.status !== 'uploading') {
      actions.appendChild(removeBtn);
    }

    const left = document.createElement('div');
    left.className = 'upload-queue-left';
    left.appendChild(name);
    left.appendChild(status);

    row.appendChild(left);
    row.appendChild(actions);
    uploadQueue.appendChild(row);
  }
}

function syncSelectionUI() {
  selectedUploadFiles = uploadFileQueue.map((item) => item.file);
  updateSelectedFileName(selectedUploadFiles);
  renderUploadQueue();
}

function appendToQueue(files) {
  if (!files?.length) return;
  const additions = files.map((file) => ({
    id: makeQueueId(file),
    file,
    status: 'queued',
    progress: 0,
    code: '',
    error: ''
  }));
  uploadFileQueue = [...uploadFileQueue, ...additions];
  syncSelectionUI();
}

function removeFromQueue(queueId) {
  uploadFileQueue = uploadFileQueue.filter((item) => item.id !== queueId);
  syncSelectionUI();
}

function updateQueueItem(queueId, patch) {
  uploadFileQueue = uploadFileQueue.map((item) => (item.id === queueId ? { ...item, ...patch } : item));
  syncSelectionUI();
}

function clearQueue() {
  uploadFileQueue = [];
  syncSelectionUI();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, LEGACY_CODE_LENGTH);
}

function getDownloadInputs() {
  return Array.from(document.querySelectorAll('.download-code-input'));
}

function getDownloadCodes() {
  return getDownloadInputs()
    .map((input) => onlyDigits(input.value))
    .filter(Boolean);
}

function addDownloadCodeInput(value = '') {
  if (!downloadCodeRows) return null;

  const row = document.createElement('div');
  row.className = 'download-code-row';

  const input = document.createElement('input');
  input.className = 'download-code-input';
  input.maxLength = LEGACY_CODE_LENGTH;
  input.inputMode = 'numeric';
  input.value = onlyDigits(value);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'small-icon-btn';
  removeBtn.setAttribute('aria-label', 'Remove code');
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => {
    row.remove();
    const inputs = getDownloadInputs();
    if (!inputs.length) addDownloadCodeInput();
  });

  row.appendChild(input);
  row.appendChild(removeBtn);
  downloadCodeRows.appendChild(row);
  input.focus();
  return input;
}

function handleDownloadCodeInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  const rawValue = target.value;
  const digitGroups = rawValue.match(/\d{3,6}/g);
  target.value = onlyDigits(rawValue);

  if (!digitGroups || digitGroups.length <= 1) return;

  target.value = onlyDigits(digitGroups[0]);
  for (const group of digitGroups.slice(1)) {
    addDownloadCodeInput(group);
  }
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

async function resolveTransferFile(transfer, storageClient = supabasePublic) {
  const { data, error } = await storageClient.storage.from(BUCKET).download(transfer.object_path);
  if (error) throw error;
  return {
    blob: data,
    filename: transfer.original_name || 'download.bin',
    contentType: transfer.content_type
  };
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
  const canUpload = loggedInUploader || loggedInAdmin;

  if (uploadBtn) uploadBtn.disabled = !canUpload;
  if (fileInput) fileInput.disabled = !canUpload;

  if (uploadLogoutBtn) uploadLogoutBtn.style.display = loggedInUploader || loggedInAdmin ? 'inline-block' : 'none';
  if (uploadActions) uploadActions.classList.toggle('hidden', !canUpload);
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

function makeSplitPartName(fileName, partIndex) {
  const safe = cleanFileName(fileName);
  return `${safe}.${String(partIndex).padStart(3, '0')}`;
}

async function createTransferRowForObject(objectPath, originalName, contentType) {
  let code = '';
  let insertError = null;

  for (let i = 0; i < 30; i += 1) {
    code = await createUniqueCode();
    const { error } = await supabase.rpc('create_transfer', {
      p_code: code,
      p_object_path: objectPath,
      p_original_name: originalName,
      p_content_type: contentType,
      p_created_at: new Date().toISOString()
    });

    if (!error) return code;

    insertError = error;
    const msg = String(error.message || '').toLowerCase();
    const isDuplicate = msg.includes('duplicate key') || msg.includes('already exists');
    if (!isDuplicate) break;
  }

  throw insertError || new Error('Could not create transfer');
}

async function loginForUploadOrAdmin() {
  if (!ensureSupabaseReady(uploadAuthStatus)) {
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
}

async function logoutUpload() {
  await supabase.auth.signOut();
  uploadUser = null;
  adminUser = null;
  selectedUploadFiles = [];
  uploadFileQueue = [];
  awaitingAdminPassword = false;
  fileInput.value = '';
  syncSelectionUI();
  uploadLoginPasswordInput.value = '';
  if (adminLogList) adminLogList.innerHTML = '';
  setStatus(adminLogStatus, '');
  refreshUploadAuthUI();
  setStatus(uploadStatus, 'Access closed.');
}

async function uploadSingleFile(queueItem) {
  const { file } = queueItem;
  updateQueueItem(queueItem.id, { status: 'uploading', progress: 15, error: '' });
  const isSplitUpload = file.size > MAX_UPLOAD_BYTES;
  if (isSplitUpload && !adminUser) {
    throw new Error('Over 50MB is admin-only.');
  }

  const uploadResults = [];
  const uploadedPaths = [];
  const totalParts = isSplitUpload ? Math.ceil(file.size / SPLIT_PART_BYTES) : 1;

  try {
    for (let index = 0; index < totalParts; index += 1) {
      const start = index * SPLIT_PART_BYTES;
      const end = Math.min(file.size, start + SPLIT_PART_BYTES);
      const partBlob = file.slice(start, end);
      const partName = totalParts === 1 ? cleanFileName(file.name) : makeSplitPartName(file.name, index + 1);
      const objectPath = `${crypto.randomUUID()}-${partName}`;

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, partBlob, { upsert: false });
      if (uploadError) throw uploadError;
      uploadedPaths.push(objectPath);

      const partCode = await createTransferRowForObject(objectPath, partName, file.type || 'application/octet-stream');
      uploadResults.push({ name: partName, code: partCode });

      const progress = 20 + Math.round(((index + 1) / totalParts) * 80);
      updateQueueItem(queueItem.id, { progress: Math.min(progress, 100) });
    }
  } catch (error) {
    if (uploadedPaths.length) {
      await supabase.storage.from(BUCKET).remove(uploadedPaths).catch(() => {});
    }
    throw error;
  }

  updateQueueItem(queueItem.id, { progress: 100 });
  return uploadResults;
}

async function uploadFile() {
  if (!ensureSupabaseReady(uploadStatus)) return;
  const queuedItems = uploadFileQueue.filter((item) => item.status === 'queued');
  const canUpload = Boolean(uploadUser || adminUser);

  if (!canUpload) {
    setStatus(uploadStatus, 'Upload access required first.', true);
    return;
  }

  if (!queuedItems.length) {
    setStatus(uploadStatus, 'No queued items to upload.', true);
    return;
  }

  for (const { file } of queuedItems) {
    if (file.size > MAX_UPLOAD_BYTES && !adminUser) {
      setStatus(uploadStatus, `Item too large for this account (max 50 MB): ${cleanFileName(file.name)}`, true);
      return;
    }
  }

  uploadBtn.disabled = true;
  generatedCode.textContent = '';
  setStatus(uploadStatus, 'Working...');

  try {
    const { data: userInfo } = await supabase.auth.getUser();
    if (!userInfo.user) {
      await supabase.auth.signOut();
      uploadUser = null;
      refreshUploadAuthUI();
      throw new Error('Session expired. Re-enter access.');
    }

    const uploaded = [];
    const failed = [];

    for (const item of queuedItems) {
      try {
        const results = await uploadSingleFile(item);
        const firstCode = results[0]?.code || '';
        updateQueueItem(item.id, { status: 'uploaded', code: firstCode, progress: 100, error: '' });
        uploaded.push(...results);
      } catch (error) {
        const msg = error.message || 'failed';
        updateQueueItem(item.id, { status: 'failed', error: msg, progress: 0 });
        failed.push(`${cleanFileName(item.file.name)} (${msg})`);
      }
    }

    if (!uploaded.length) {
      throw new Error(failed[0] || 'Upload failed.');
    }

    generatedCode.textContent = uploaded.map((item) => `${item.code} - ${item.name}`).join('\n');
    const successText = `${uploaded.length} file(s) uploaded.`;
    const failText = failed.length ? ` ${failed.length} failed.` : '';
    setStatus(uploadStatus, `Done. ${successText}${failText}`);

    if (failed.length) {
      setStatus(uploadAuthStatus, `Failed: ${failed.join(', ')}`, true);
    }

    fileInput.value = '';
    syncSelectionUI();
  } catch (error) {
    setStatus(uploadStatus, error.message || 'Action failed', true);
  } finally {
    uploadBtn.disabled = false;
  }
}

async function downloadOneCode(code) {
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

  const resolved = await resolveTransferFile(transfer, supabasePublic);
  triggerDownload(resolved.blob, resolved.filename || `download-${code}`, resolved.contentType);
}

async function downloadWithCode() {
  if (!ensureSupabaseReady(downloadStatus)) return;

  const inputs = getDownloadInputs();
  for (const input of inputs) input.value = onlyDigits(input.value);

  const codes = getDownloadCodes();
  if (!codes.length) {
    setStatus(downloadStatus, 'Enter at least one value.', true);
    return;
  }

  const invalidCode = codes.find((code) => code.length !== CODE_LENGTH && code.length !== LEGACY_CODE_LENGTH);
  if (invalidCode) {
    setStatus(downloadStatus, `Each value must be ${CODE_LENGTH} or ${LEGACY_CODE_LENGTH} digits.`, true);
    return;
  }

  downloadBtn.disabled = true;
  if (addDownloadCodeBtn) addDownloadCodeBtn.disabled = true;
  setStatus(downloadStatus, `Checking ${codes.length} item(s)...`);

  const failed = [];
  let completed = 0;

  try {
    for (const code of codes) {
      try {
        await downloadOneCode(code);
        completed += 1;
        setStatus(downloadStatus, `Completed ${completed}/${codes.length}.`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (error) {
        failed.push(`${code} (${error.message || 'failed'})`);
      }
    }

    if (failed.length) {
      setStatus(downloadStatus, `Completed ${completed}/${codes.length}. Failed: ${failed.join(', ')}`, true);
      return;
    }

    setStatus(downloadStatus, `Completed ${completed}/${codes.length}. Values are now invalid.`);
    for (const input of inputs) input.value = '';
  } catch (error) {
    setStatus(downloadStatus, error.message || 'Action failed', true);
  } finally {
    downloadBtn.disabled = false;
    if (addDownloadCodeBtn) addDownloadCodeBtn.disabled = false;
  }
}


async function adminDownload(objectPath, originalName, contentType) {
  if (!adminUser) {
    setStatus(adminLogStatus, 'Admin access required.', true);
    return;
  }

  try {
    const resolved = await resolveTransferFile(
      { object_path: objectPath, original_name: originalName, content_type: contentType },
      supabase
    );
    triggerDownload(resolved.blob, resolved.filename || 'file.bin', resolved.contentType);
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
  if (!ensureSupabaseReady(adminLogStatus)) return;

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
      await supabase.storage.from(BUCKET).remove([row.object_path]).catch(() => {});
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

if (downloadCodeRows) {
  downloadCodeRows.addEventListener('input', handleDownloadCodeInput);
  downloadCodeRows.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (!(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    downloadWithCode();
  });
}
if (addDownloadCodeBtn) addDownloadCodeBtn.addEventListener('click', () => addDownloadCodeInput());

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
    const files = fileInput.files ? Array.from(fileInput.files) : [];
    appendToQueue(files);
    fileInput.value = '';
  });
}

if (uploadQueue) {
  uploadQueue.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const queueId = target.dataset.queueId;
    const action = target.dataset.action;
    if (!queueId) return;
    if (action === 'retry') {
      updateQueueItem(queueId, { status: 'queued', error: '', progress: 0, code: '' });
      setStatus(uploadStatus, 'Queue item ready to retry.');
      return;
    }
    removeFromQueue(queueId);
    setStatus(uploadStatus, 'Queue item removed.');
  });
}

if (clearQueueBtn) {
  clearQueueBtn.addEventListener('click', () => {
    clearQueue();
    setStatus(uploadStatus, 'Queue cleared.');
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
    if (!uploadUser && !adminUser) return;
    const droppedFiles = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    if (!droppedFiles.length) return;
    appendToQueue(droppedFiles);
    setStatus(uploadStatus, `${droppedFiles.length} item(s) added to queue.`);
  });
}

(async () => {
  if (!downloadCodeInput || !downloadBtn || !uploadLoginPasswordInput || !uploadLoginBtn) {
    console.error('UI wiring failed: required elements are missing.');
    return;
  }

  if (!ensureSupabaseReady(uploadAuthStatus)) {
    if (uploadBtn) uploadBtn.disabled = true;
    if (downloadBtn) downloadBtn.disabled = true;
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
  syncSelectionUI();
  bindDropZone();

  if (adminUser) {
    await loadAdminLogs();
  }
})();
