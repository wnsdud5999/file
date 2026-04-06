import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  onSnapshot,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot as onCollectionSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

// Fill these with your Firebase project settings.
const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME'
};

// One shared account for everyone with your password.
const SHARED_EMAIL = 'shared-note@yourdomain.com';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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

const noteDocRef = doc(db, 'shared', 'main');
const commitsRef = collection(db, 'shared', 'main', 'commits');

let unsubs = [];

function setStatus(text, isError = false) {
  editorStatus.textContent = text;
  editorStatus.style.color = isError ? '#b42318' : '#475467';
}

function renderCommits(items) {
  commitList.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    const when = item.ts?.toDate ? item.ts.toDate().toLocaleString() : 'just now';
    li.textContent = `[${when}] ${item.author || 'anonymous'}: ${item.message || 'Updated shared document'}`;
    commitList.appendChild(li);
  });
}

async function ensureInitialDoc() {
  const snap = await getDoc(noteDocRef);
  if (!snap.exists()) {
    await setDoc(noteDocRef, {
      content: 'Welcome!\\n\\nThis is a shared Firebase document.\\n',
      updatedAt: serverTimestamp(),
      updatedBy: 'system'
    });
    await addDoc(commitsRef, {
      author: 'system',
      message: 'Initial document created',
      ts: serverTimestamp()
    });
  }
}

function startRealtimeSync() {
  unsubs.forEach((fn) => fn());
  unsubs = [];

  unsubs.push(
    onSnapshot(noteDocRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (typeof data.content === 'string' && editor.value !== data.content) {
        editor.value = data.content;
        setStatus('Document updated by another user.');
      }
    })
  );

  const commitQuery = query(commitsRef, orderBy('ts', 'desc'), limit(20));
  unsubs.push(
    onCollectionSnapshot(commitQuery, (snap) => {
      const items = snap.docs.map((d) => d.data());
      renderCommits(items);
    })
  );
}

function showEditor() {
  loginCard.classList.add('hidden');
  editorCard.classList.remove('hidden');
}

function showLogin() {
  editorCard.classList.add('hidden');
  loginCard.classList.remove('hidden');
}

loginBtn.addEventListener('click', async () => {
  loginStatus.textContent = '';
  const password = passwordInput.value;

  try {
    await signInWithEmailAndPassword(auth, SHARED_EMAIL, password);
    passwordInput.value = '';
  } catch (err) {
    loginStatus.textContent = `Login failed: ${err.message}`;
    loginStatus.style.color = '#b42318';
  }
});

commitBtn.addEventListener('click', async () => {
  commitBtn.disabled = true;
  setStatus('Committing...');

  try {
    const author = authorInput.value.trim() || 'anonymous';
    const message = messageInput.value.trim() || 'Updated shared document';

    await setDoc(
      noteDocRef,
      {
        content: editor.value,
        updatedAt: serverTimestamp(),
        updatedBy: author
      },
      { merge: true }
    );

    await addDoc(commitsRef, {
      author,
      message,
      ts: serverTimestamp()
    });

    messageInput.value = '';
    setStatus('Committed! Everyone will see this update.');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    commitBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    unsubs.forEach((fn) => fn());
    unsubs = [];
    showLogin();
    return;
  }

  await ensureInitialDoc();
  showEditor();
  startRealtimeSync();
  setStatus('Connected.');
});
