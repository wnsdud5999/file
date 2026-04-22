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
const SUPABASE_URL = APP_CONFIG.SUPABASE_URL || 'REPLACE_SUPABASE_URL';
const SUPABASE_ANON_KEY = APP_CONFIG.SUPABASE_ANON_KEY || 'REPLACE_SUPABASE_ANON_KEY';
const SUPABASE_UPLOAD_EMAIL = APP_CONFIG.SUPABASE_UPLOAD_EMAIL || 'upload-user@example.com';
const SUPABASE_ADMIN_EMAIL = APP_CONFIG.SUPABASE_ADMIN_EMAIL || 'admin@email.com';
// ===================================

const BUCKET = 'private-send-files';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const CHUNK_UPLOAD_BYTES = 45 * 1024 * 1024; // under provider soft-limit
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

const MANIFEST_CONTENT_TYPE = 'application/x-private-send-manifest+json';

function setStatus(target, message, error = false) {
  if (!target) return;
  target.textContent = message;
  target.style.color = error ? '#ff6b6b' : '#b8b8c5';
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

function isManifestTransfer(transfer) {
  const objectPath = String(transfer?.object_path || '');
  return transfer?.content_type === MANIFEST_CONTENT_TYPE || objectPath.endsWith('manifest.json');
}

async function uploadChunkedFile(file, queueId) {
  const prefix = crypto.randomUUID();
  const safeName = cleanFileName(file.name);
  const totalChunks = Math.ceil(file.size / CHUNK_UPLOAD_BYTES);
  const chunkPaths = [];

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * CHUNK_UPLOAD_BYTES;
    const end = Math.min(file.size, start + CHUNK_UPLOAD_BYTES);
    const chunkBlob = file.slice(start, end);
    const chunkPath = `${prefix}/chunks/${String(index + 1).padStart(4, '0')}.part`;
    const { error } = await supabase.storage.from(BUCKET).upload(chunkPath, chunkBlob, { upsert: false });
    if (error) throw error;
    chunkPaths.push(chunkPath);
    const progress = 20 + Math.round(((index + 1) / totalChunks) * 65);
    updateQueueItem(queueId, { progress: Math.min(progress, 95) });
  }

  const manifest = {
    kind: 'chunked-transfer',
    originalName: safeName,
    originalType: file.type || 'application/octet-stream',
    totalSize: file.size,
    chunkSize: CHUNK_UPLOAD_BYTES,
    totalChunks,
    chunks: chunkPaths
  };

  const manifestPath = `${prefix}/manifest.json`;
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: MANIFEST_CONTENT_TYPE });
  const { error: manifestError } = await supabase.storage.from(BUCKET).upload(manifestPath, manifestBlob, { upsert: false });
  if (manifestError) {
    await supabase.storage.from(BUCKET).remove(chunkPaths).catch(() => {});
    throw manifestError;
  }

  return {
    objectPath: manifestPath,
    originalName: safeName,
    contentType: MANIFEST_CONTENT_TYPE,
    cleanupPaths: [...chunkPaths, manifestPath]
  };
}

async function resolveTransferFile(transfer, storageClient = supabasePublic) {
  if (!isManifestTransfer(transfer)) {
    const { data, error } = await storageClient.storage.from(BUCKET).download(transfer.object_path);
    if (error) throw error;
    return {
      blob: data,
      filename: transfer.original_name || 'download.bin',
      contentType: transfer.content_type
    };
  }

  const { data: manifestBlob, error: manifestError } = await storageClient.storage.from(BUCKET).download(transfer.object_path);
  if (manifestError) throw manifestError;

  const manifest = JSON.parse(await manifestBlob.text());
  if (!Array.isArray(manifest.chunks) || !manifest.chunks.length) {
    throw new Error('Manifest invalid: no chunks found.');
  }

  const chunkBlobs = [];
  for (const chunkPath of manifest.chunks) {
    const { data: chunkData, error: chunkError } = await storageClient.storage.from(BUCKET).download(chunkPath);
    if (chunkError) throw chunkError;
    chunkBlobs.push(chunkData);
  }

  return {
    blob: new Blob(chunkBlobs, { type: manifest.originalType || 'application/octet-stream' }),
    filename: manifest.originalName || transfer.original_name || 'download.bin',
    contentType: manifest.originalType || 'application/octet-stream'
  };
}

async function deleteTransferAssets(transfer, storageClient = supabase) {
  const paths = [transfer.object_path];
  if (isManifestTransfer(transfer)) {
    try {
      const { data: manifestBlob, error } = await storageClient.storage.from(BUCKET).download(transfer.object_path);
      if (!error) {
        const manifest = JSON.parse(await manifestBlob.text());
        if (Array.isArray(manifest.chunks)) {
          for (const pathItem of manifest.chunks) paths.push(pathItem);
        }
      }
    } catch {
      // best effort cleanup only
    }
  }

  const uniquePaths = [...new Set(paths)];
  await storageClient.storage.from(BUCKET).remove(uniquePaths);
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

async function loginForUploadOrAdmin() {
  if (SUPABASE_URL.includes('REPLACE_') || SUPABASE_ANON_KEY.includes('REPLACE_')) {
    setStatus(uploadAuthStatus, 'Please set SUPABASE_URL + SUPABASE_ANON_KEY in app.js.', true);
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
  let uploadTarget = {
    objectPath: `${crypto.randomUUID()}-${cleanFileName(file.name)}`,
    originalName: cleanFileName(file.name),
    contentType: file.type || 'application/octet-stream',
    cleanupPaths: []
  };

  if (file.size > MAX_UPLOAD_BYTES) {
    if (!adminUser) {
      throw new Error('Over 50MB is admin-only.');
    }
    uploadTarget = await uploadChunkedFile(file, queueItem.id);
  } else {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uploadTarget.objectPath, file, { upsert: false });

    if (uploadError) throw uploadError;
    uploadTarget.cleanupPaths = [uploadTarget.objectPath];
    updateQueueItem(queueItem.id, { progress: 60 });
  }

  let code = '';
  let insertError = null;

  for (let i = 0; i < 30; i += 1) {
    code = await createUniqueCode();

    const { error } = await supabase.rpc('create_transfer', {
      p_code: code,
      p_object_path: uploadTarget.objectPath,
      p_original_name: uploadTarget.originalName,
      p_content_type: uploadTarget.contentType,
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
    await supabase.storage.from(BUCKET).remove(uploadTarget.cleanupPaths);
    throw insertError;
  }

  updateQueueItem(queueItem.id, { progress: 100 });
  return code;
}

async function uploadFile() {
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
        const code = await uploadSingleFile(item);
        updateQueueItem(item.id, { status: 'uploaded', code, progress: 100, error: '' });
        uploaded.push({ name: cleanFileName(item.file.name), code });
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

async function downloadWithCode() {
  const code = onlyDigits(downloadCodeInput.value);
  downloadCodeInput.value = code;

  if (SUPABASE_URL.includes('REPLACE_') || SUPABASE_ANON_KEY.includes('REPLACE_')) {
    setStatus(downloadStatus, 'Please set SUPABASE_URL + SUPABASE_ANON_KEY in app.js.', true);
    return;
  }

  if (code.length !== CODE_LENGTH && code.length !== LEGACY_CODE_LENGTH) {
    setStatus(downloadStatus, `Value must be ${CODE_LENGTH} or ${LEGACY_CODE_LENGTH} digits.`, true);
    return;
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

    const resolved = await resolveTransferFile(transfer, supabasePublic);
    triggerDownload(resolved.blob, resolved.filename || `download-${code}`, resolved.contentType);

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
      await deleteTransferAssets(row, supabase).catch(() => {});
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
    if (!uploadUser) return;
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
