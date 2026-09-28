# Compound Your Wins

A phone-friendly personal archive for wins, memories, practices, and the changes they lead to. Built with plain HTML, CSS, and JavaScript, with data stored locally in IndexedDB.

## What it does

Record progress over time, connect related entries, and look back at the work behind a result.

## Engineering choices

- **Device-local storage:** `db.js` validates entries before storing them in IndexedDB. No server or account is required.
- **Offline use:** `sw.js` caches the app shell and local assets. The manifest and icons support installation as a web app.
- **Structured records:** entries can carry business or practice/shift data, with validation for dates, amounts, and relationships.
- **Backups:** export/import lets a user carry their archive outside the browser.

The repository contains app code, not my personal archive. Browser storage is not a backup: clearing it or losing the device can remove entries. Export regularly. There is no cross-device synchronization.

## Run locally

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. Service workers require HTTPS or localhost. Open the app online once before using the cached version offline.

No package install or build step is required.

## Code map

| File | Responsibility |
| --- | --- |
| `index.html`, `style.css` | Interface and responsive layout |
| `app.js` | Entry forms, filters, timelines, and views |
| `db.js` | Validation, relationships, IndexedDB persistence, import/export |
| `sw.js` | Offline asset caching |
| `manifest.json` | Installable web-app metadata |

## Manual checks

Create and edit an entry, reload to check persistence, export a backup, and test import using disposable data. After the initial load, check offline reopening. These are suggested verification steps, not a claim of automated test coverage.

[About me and my other work](https://jack-codet-portfolio.vercel.app)
