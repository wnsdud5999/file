import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ====== CHANGE THESE 3 VALUES ======
const SUPABASE_URL = 'https://pnyimurfileqbesoasdl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBueWltdXJmaWxlcWJlc29hc2RsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDczMzAsImV4cCI6MjA5MTAyMzMzMH0.HCj5kpgu0D5b4-b02OkejdJrLdo4XX-ZrfzJ8ceW7UY';
const SUPABASE_UPLOAD_EMAIL = 'upload-user@example.com';
// ===================================

const BUCKET = 'private-send-files';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const CODE_TTL_MS = 24 * 60 * 60 * 1000;

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
const uploadBtn = document.getElementById('uploadBtn');
const uploadActions = document.getElementById('uploadActions');
const uploadHint = document.getElementById('uploadHint');
const uploadStatus = document.getElementById('uploadStatus');
const generatedCode = document.getElementById('generatedCode');

let uploadUser = null;

function setStatus(target, message, error = false) {
  target.textContent = message;
  target.style.color = error ? '#b42318' : '#475467';
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function randomCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

function cleanFileName(name) {
  return String(name || 'file.bin').replace(/[^a-zA-Z0-9._\- ()]/g, '_');
}

function refreshUploadAuthUI() {
  const loggedIn = Boolean(uploadUser);
  uploadBtn.disabled = !loggedIn;
  fileInput.disabled = !loggedIn;
  uploadLogoutBtn.style.display = loggedIn ? 'inline-block' : 'none';
  uploadActions.classList.toggle('hidden', !loggedIn);
  uploadHint.style.display = loggedIn ? 'none' : 'block';

  if (loggedIn) {
    setStatus(uploadAuthStatus, `Upload login active: ${uploadUser.email}`);
  } else {
    setStatus(uploadAuthStatus, 'Upload login required.');
  }
}

async function createUniqueCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = randomCode();
    const { data, error } = await supabase
      .from('transfers')
      .select('code')
      .eq('code', code)
      .limit(1);

    if (error) throw error;
    if (!data.length) return code;
  }
  throw new Error('Could not generate code. Try again.');
}

async function loginForUpload() {
  if (SUPABASE_URL.includes('REPLACE_') || SUPABASE_ANON_KEY.includes('REPLACE_')) {
    setStatus(uploadAuthStatus, 'Please set SUPABASE_URL + SUPABASE_ANON_KEY in main.js.', true);
    return;
  }

  const password = uploadLoginPasswordInput.value;
  if (!password) {
    setStatus(uploadAuthStatus, 'Enter upload account password.', true);
    return;
  }

  uploadLoginBtn.disabled = true;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: SUPABASE_UPLOAD_EMAIL,
      password
    });

    if (error) throw error;
    uploadUser = data.user;
    uploadLoginPasswordInput.value = '';
    refreshUploadAuthUI();
    setStatus(uploadStatus, 'Now you can upload files.');
  } catch (error) {
    setStatus(uploadAuthStatus, error.message || 'Upload login failed.', true);
  } finally {
    uploadLoginBtn.disabled = false;
  }
}

async function logoutUpload() {
  await supabase.auth.signOut();
  uploadUser = null;
  refreshUploadAuthUI();
  setStatus(uploadStatus, 'Upload login removed.');
}

async function uploadFile() {
  const file = fileInput.files && fileInput.files[0];

  if (!uploadUser) {
    setStatus(uploadStatus, 'Please login for upload first.', true);
    return;
  }

  if (!file) {
    setStatus(uploadStatus, 'Pick a file first.', true);
    return;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    setStatus(uploadStatus, 'File too big. Max is 50 MB.', true);
    return;
  }

  uploadBtn.disabled = true;
  generatedCode.textContent = '';
  setStatus(uploadStatus, 'Uploading...');

  try {
    const code = await createUniqueCode();
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
      throw new Error('Upload session expired. Please login again.');
    }

    const { error: insertError } = await supabase.rpc('create_transfer', {
      p_code: code,
      p_object_path: objectPath,
      p_original_name: cleanFileName(file.name),
      p_content_type: file.type || 'application/octet-stream',
      p_created_at: new Date().toISOString()
    });

    if (insertError) {
      await supabase.storage.from(BUCKET).remove([objectPath]);
      if ((insertError.message || '').toLowerCase().includes('row-level security')) {
        throw new Error('Supabase policy not ready. Run README SQL step again (create_transfer function).');
      }
      throw insertError;
    }

    setStatus(uploadStatus, 'Upload done. Share this code:');
    generatedCode.textContent = code;
    fileInput.value = '';
  } catch (error) {
    setStatus(uploadStatus, error.message || 'Upload failed', true);
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

  if (code.length !== 6) {
    setStatus(downloadStatus, 'Code must be 6 digits.', true);
    return;
  }

  downloadBtn.disabled = true;
  setStatus(downloadStatus, 'Checking code...');

  try {
    const { data: rows, error: rowError } = await supabasePublic
      .from('transfers')
      .select('code, object_path, original_name, content_type, created_at')
      .eq('code', code)
      .limit(1);

    if (rowError) throw rowError;
    if (!rows.length) throw new Error('Code not found or already used.');

    const transfer = rows[0];
    const age = Date.now() - new Date(transfer.created_at).getTime();

    if (Number.isFinite(age) && age > CODE_TTL_MS) {
      await supabasePublic.storage.from(BUCKET).remove([transfer.object_path]);
      await supabasePublic.from('transfers').delete().eq('code', code);
      throw new Error('Code expired.');
    }

    const { data: fileData, error: downloadError } = await supabasePublic.storage
      .from(BUCKET)
      .download(transfer.object_path);

    if (downloadError) throw downloadError;

    await supabasePublic.storage.from(BUCKET).remove([transfer.object_path]);
    await supabasePublic.from('transfers').delete().eq('code', code);

    const blob = new Blob([fileData], { type: transfer.content_type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = transfer.original_name || `download-${code}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus(downloadStatus, 'Downloaded. Code is now used and deleted.');
    downloadCodeInput.value = '';
  } catch (error) {
    setStatus(downloadStatus, error.message || 'Download failed', true);
  } finally {
    downloadBtn.disabled = false;
  }
}

downloadCodeInput.addEventListener('input', () => {
  downloadCodeInput.value = onlyDigits(downloadCodeInput.value);
});

uploadLoginBtn.addEventListener('click', loginForUpload);
uploadLogoutBtn.addEventListener('click', logoutUpload);
downloadBtn.addEventListener('click', downloadWithCode);
uploadBtn.addEventListener('click', uploadFile);

(async () => {
  const { data } = await supabase.auth.getSession();
  uploadUser = data.session?.user || null;
  refreshUploadAuthUI();
})();
