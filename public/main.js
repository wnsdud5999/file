const downloadCodeInput = document.getElementById('downloadCodeInput');
const downloadBtn = document.getElementById('downloadBtn');
const downloadStatus = document.getElementById('downloadStatus');

const uploadPasswordInput = document.getElementById('uploadPasswordInput');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const uploadStatus = document.getElementById('uploadStatus');
const generatedCode = document.getElementById('generatedCode');

function setStatus(target, message, error = false) {
  target.textContent = message;
  target.style.color = error ? '#b42318' : '#475467';
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

async function toBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

async function uploadFile() {
  const file = fileInput.files && fileInput.files[0];
  const uploadPassword = uploadPasswordInput.value;

  if (!uploadPassword) {
    setStatus(uploadStatus, 'Enter upload password first.', true);
    return;
  }

  if (!file) {
    setStatus(uploadStatus, 'Pick a file first.', true);
    return;
  }

  uploadBtn.disabled = true;
  generatedCode.textContent = '';
  setStatus(uploadStatus, 'Uploading...');

  try {
    const contentBase64 = await toBase64(file);

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadPassword,
        fileName: file.name,
        contentBase64,
        contentType: file.type || 'application/octet-stream'
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    setStatus(uploadStatus, 'Upload done. Share this code:');
    generatedCode.textContent = data.code;
    fileInput.value = '';
  } catch (error) {
    setStatus(uploadStatus, error.message, true);
  } finally {
    uploadBtn.disabled = false;
  }
}

async function downloadWithCode() {
  const code = onlyDigits(downloadCodeInput.value);
  downloadCodeInput.value = code;

  if (code.length !== 6) {
    setStatus(downloadStatus, 'Code must be 6 digits.', true);
    return;
  }

  downloadBtn.disabled = true;
  setStatus(downloadStatus, 'Checking code...');

  try {
    const res = await fetch(`/api/download?code=${encodeURIComponent(code)}`);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Download failed');
    }

    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename="?([^\"]+)"?/i);
    const fileName = match ? match[1] : `download-${code}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus(downloadStatus, 'Downloaded. This code is now deleted forever.');
    downloadCodeInput.value = '';
  } catch (error) {
    setStatus(downloadStatus, error.message, true);
  } finally {
    downloadBtn.disabled = false;
  }
}

downloadCodeInput.addEventListener('input', () => {
  downloadCodeInput.value = onlyDigits(downloadCodeInput.value);
});

downloadBtn.addEventListener('click', downloadWithCode);
uploadBtn.addEventListener('click', uploadFile);
