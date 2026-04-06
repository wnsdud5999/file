import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

// 1) Paste your Firebase Web app config here.
const firebaseConfig = {
  apiKey: "AIzaSyDbRIKSvB5OVK9Td8AklSLmayGwh9Geys0",
  authDomain: "note-2a6f8.firebaseapp.com",
  projectId: "note-2a6f8",
  storageBucket: "note-2a6f8.firebasestorage.app",
  messagingSenderId: "556359673920",
  appId: "1:556359673920:web:0e56743418cb667d6797a5",
};

// 2) Shared login email. Users type only password in UI.
const SHARED_EMAIL = 'sharedemail@email.com';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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
const newNoteBtn = document.getElementById('newNoteBtn');

let notes = [];
let selectedNoteId = null;
let unsubNotes = null;
let unsubCommits = null;

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

function clearRealtime() {
  if (unsubNotes) {
    unsubNotes();
    unsubNotes = null;
  }
  if (unsubCommits) {
    unsubCommits();
    unsubCommits = null;
  }
}

function renderNotes() {
  noteList.innerHTML = '';

  notes.forEach((note) => {
    const li = document.createElement('li');
    li.className = note.id === selectedNoteId ? 'active' : '';

    const updatedAtText = note.updatedAt
      ? new Date(note.updatedAt).toLocaleString()
      : 'just now';

    const titleWrap = document.createElement('div');
    titleWrap.innerHTML = `<strong>${note.title || 'Untitled note'}</strong><small>${updatedAtText}</small>`;

    li.appendChild(titleWrap);
    li.addEventListener('click', () => {
      selectNote(note.id);
    });

    noteList.appendChild(li);
  });
}

function renderCommits(items = []) {
  commitList.innerHTML = '';

  items.forEach((item) => {
    const li = document.createElement('li');
    const ts = item.ts ? new Date(item.ts).toLocaleString() : 'just now';
    li.textContent = `[${ts}] ${item.author || 'anonymous'}: ${item.message || 'Updated note'}`;
    commitList.appendChild(li);
  });
}

function getSelectedNote() {
  return notes.find((n) => n.id === selectedNoteId) || null;
}

function clearEditorPanels() {
  noteTitleInput.value = '';
  editor.value = '';
  renderCommits([]);
}

function selectNote(noteId) {
  selectedNoteId = noteId;
  const selected = getSelectedNote();

  noteTitleInput.value = selected?.title || '';
  editor.value = selected?.content || '';

  renderNotes();
  startCommitListener();
}

async function ensureInitialData() {
  const noteRef = doc(db, 'notes', 'welcome');
  const existing = await getDoc(noteRef);

  if (!existing.exists()) {
    await setDoc(noteRef, {
      title: 'Welcome note',
      content: 'Welcome!\n\nCreate notes, edit title/content, and commit changes.',
      updatedAt: serverTimestamp(),
      updatedBy: 'system'
    });

    await addDoc(collection(db, 'notes', 'welcome', 'commits'), {
      author: 'system',
      message: 'Initial note created',
      ts: serverTimestamp()
    });
  }
}

async function createNote() {
  const rawTitle = window.prompt('New note title:', 'New note');
  if (!rawTitle) return;

  const title = rawTitle.trim() || 'Untitled note';
  const author = authorInput.value.trim() || 'anonymous';
  const noteRef = doc(collection(db, 'notes'));

  await setDoc(noteRef, {
    title,
    content: '',
    updatedAt: serverTimestamp(),
    updatedBy: author
  });

  await addDoc(collection(db, 'notes', noteRef.id, 'commits'), {
    author,
    message: `Created note "${title}"`,
    ts: serverTimestamp()
  });

  setStatus('New note created.');
  selectedNoteId = noteRef.id;
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

    await updateDoc(doc(db, 'notes', selectedNoteId), {
      title: noteTitleInput.value.trim() || 'Untitled note',
      content: editor.value,
      updatedAt: serverTimestamp(),
      updatedBy: author
    });

    await addDoc(collection(db, 'notes', selectedNoteId, 'commits'), {
      author,
      message,
      ts: serverTimestamp()
    });

    messageInput.value = '';
    setStatus('Committed! Everyone will see this note update.');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    commitBtn.disabled = false;
  }
}

async function deleteCurrentNote() {
  if (!selectedNoteId) {
    setStatus('Select a note first.', true);
    return;
  }

  const selected = getSelectedNote();
  const ok = window.confirm(`Delete note "${selected?.title || 'Untitled note'}"?`);
  if (!ok) return;

  await deleteDoc(doc(db, 'notes', selectedNoteId));
  selectedNoteId = null;
  clearEditorPanels();
  setStatus('Note deleted.');
}

function startNotesListener() {
  const notesQuery = query(collection(db, 'notes'), orderBy('updatedAt', 'desc'));

  unsubNotes = onSnapshot(
    notesQuery,
    (snapshot) => {
      notes = snapshot.docs.map((snap) => {
        const data = snap.data();
        return {
          id: snap.id,
          title: data.title || 'Untitled note',
          content: data.content || '',
          updatedAt: data.updatedAt?.toDate?.() ?? null,
          updatedBy: data.updatedBy || null
        };
      });

      if (!notes.length) {
        selectedNoteId = null;
        clearEditorPanels();
        renderNotes();
        return;
      }

      if (!selectedNoteId || !notes.some((n) => n.id === selectedNoteId)) {
        selectedNoteId = notes[0].id;
      }

      const selected = getSelectedNote();
      noteTitleInput.value = selected?.title || '';
      editor.value = selected?.content || '';

      renderNotes();
      startCommitListener();
    },
    (err) => {
      setStatus(err.message, true);
    }
  );
}

function startCommitListener() {
  if (unsubCommits) {
    unsubCommits();
    unsubCommits = null;
  }

  if (!selectedNoteId) {
    renderCommits([]);
    return;
  }

  const commitsQuery = query(
    collection(db, 'notes', selectedNoteId, 'commits'),
    orderBy('ts', 'desc')
  );

  unsubCommits = onSnapshot(
    commitsQuery,
    (snapshot) => {
      const items = snapshot.docs.slice(0, 20).map((snap) => {
        const data = snap.data();
        return {
          author: data.author || 'anonymous',
          message: data.message || 'Updated note',
          ts: data.ts?.toDate?.() ?? null
        };
      });

      renderCommits(items);
    },
    (err) => {
      setStatus(err.message, true);
    }
  );
}

loginBtn.addEventListener('click', async () => {
  loginStatus.textContent = '';

  try {
    await signInWithEmailAndPassword(auth, SHARED_EMAIL, passwordInput.value);
    passwordInput.value = '';
  } catch (err) {
    loginStatus.textContent = `Login failed: ${err.message}`;
    loginStatus.style.color = '#f97066';
  }
});

newNoteBtn.addEventListener('click', async () => {
  try {
    await createNote();
  } catch (err) {
    setStatus(err.message, true);
  }
});

commitBtn.addEventListener('click', commitCurrentNote);
deleteNoteBtn.addEventListener('click', async () => {
  try {
    await deleteCurrentNote();
  } catch (err) {
    setStatus(err.message, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearRealtime();
    showLogin();
    return;
  }

  try {
    await ensureInitialData();

    if (!unsubNotes) {
      startNotesListener();
    }

    showApp();
    setStatus('Connected.');
  } catch (err) {
    showLogin();
    loginStatus.textContent = `Setup error: ${err.message}`;
    loginStatus.style.color = '#f97066';
  }
});
