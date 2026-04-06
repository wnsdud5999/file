# Shared Firebase Note (GitHub Pages compatible)

This version is **frontend-only** so you can host it on **GitHub Pages**.

It uses Firebase for:
- Authentication (one shared email + password)
- Firestore document storage
- Real-time updates across users

## 1) Create Firebase project

1. Go to Firebase Console and create a project.
2. Enable **Authentication > Email/Password**.
3. Create one user account (example email: `shared-note@yourdomain.com`) and set the password to your shared password (`wnsdud5999@` if you want).
4. Enable **Firestore Database** (production mode).

## 2) Update config in `main.js`

Replace `firebaseConfig` placeholders and set `SHARED_EMAIL` to the shared account email.

## 3) Firestore security rules

Use rules like:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /shared/main {
      allow read, write: if request.auth != null;
      match /commits/{docId} {
        allow read, write: if request.auth != null;
      }
    }
  }
}
```

## 4) Publish on GitHub Pages

1. Push this repo to GitHub.
2. In repo settings, enable Pages and set source to root branch.
3. Open your Pages URL.

## Notes

- This is collaborative and real-time.
- Anyone with the shared password can edit.
- If you need per-user accounts/roles, expand Auth + security rules.
