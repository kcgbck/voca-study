# FOLLOWUP-27: PWA App-Scoped Cache & Registration Boundary Audit

**Date:** 2026-10-24 KST  
**Author:** Gemini (Implementer)  
**Supervision & Verification:** Codex (Test / Audit / Commit / Deploy)  
**Scope:** Canonical Main Root (`https://voca-study-akf.pages.dev/`)

---

## 1. Background & Discovered Defects

FOLLOWUP-26 consolidated the application into the canonical root `/` entry point. In FOLLOWUP-27, an audit of the manual refresh and PWA cache cleanup handlers revealed two boundary-leak defects:

1. **`public/sw.js` Unscoped Cache Deletion in `CLEAR_CACHE` Listener:**
   - Previous code:
     ```javascript
     if (event.data && event.data.type === 'CLEAR_CACHE') {
       event.waitUntil(
         caches.keys().then((keyList) => {
           return Promise.all(keyList.map((key) => caches.delete(key)));
         })
       );
     }
     ```
   - *Defect:* Other modules or subpath apps on the same origin can have their own CacheStorage keys; these were deleted without checking app ownership (`voca-study-cache-`). Browsers already isolate different origins.

2. **`src/app/App.tsx` Unscoped Cache Deletion & Service Worker Broadcast in `handleForceAppUpdate`:**
   - Previous code:
     ```typescript
     if ('caches' in window) {
       const cacheKeys = await caches.keys();
       await Promise.all(cacheKeys.map((key) => caches.delete(key)));
     }
     if ('serviceWorker' in navigator) {
       const registrations = await navigator.serviceWorker.getRegistrations();
       for (const reg of registrations) {
         reg.active?.postMessage({ type: 'CLEAR_CACHE' });
         reg.active?.postMessage({ type: 'SKIP_WAITING' });
         await reg.update().catch(() => {});
       }
     }
     ```
   - *Defect 1:* `caches.delete(key)` unconditionally wiped all caches on the origin.
   - *Defect 2:* `navigator.serviceWorker.getRegistrations()` iterated through *every* registration on the origin (e.g., if there were multiple apps or scoped workers like `/other-app/`) and broadcast `CLEAR_CACHE` and `SKIP_WAITING` to all of them, potentially disrupting other service workers.

---

## 2. Minimal Grounded Fixes Implemented

### 2.1 `public/sw.js`
- Bumped version to `v9.0.0` with cache name `voca-study-cache-v9`.
- Added prefix guard `key.startsWith('voca-study-cache-')` before deleting keys in response to `CLEAR_CACHE`:
  ```javascript
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keyList) => {
        return Promise.all(
          keyList.map((key) => {
            if (key.startsWith('voca-study-cache-')) {
              return caches.delete(key);
            }
          })
        );
      })
    );
  }
  ```

### 2.2 `src/app/App.tsx`
- Filtered `caches.keys()` in `handleForceAppUpdate` to only delete keys matching `key.startsWith('voca-study-cache-')`.
- Computed `appRootScope = new URL('/', window.location.href).href;` and filtered `registrations` to only target the service worker whose `reg.scope === appRootScope`.
- Protected user data in `IndexedDB`, `localStorage`, and built-in word files.
- Did not change conversation lesson models, prompt structures, or speech recognition timeouts.

---

## 3. Pending & Unverified Items (Preserved)

As mandated by project rules, the following items remain explicitly **unverified / pending physical device test**:
1. **Real S25 Chrome Physical Testing:** Identical repeat speed, actual microphone/transcription accuracy, and native Web Speech API final/interim speech behavior. No new wake-lock or level-meter feature is implied.
2. **PWA Standalone & iOS WebKit Environment:** Safe-area insets, iOS background audio/STT constraints.
3. **Curriculum & Native Review:** Teacher / pedagogical review of generated feedback and lesson sequencing.
4. **External Audit:** Third-party independent review.
5. **Board Documentation Attachments:** `BOARD-01` source attachment and `BOARD-12A` file browser verification.

---

## 4. Next Actions for Codex
1. Run and update unit/integration tests (e.g. `tests/serviceWorkerNavigation.test.ts` and `tests/pwaUpdateRegistration.test.ts`).
2. Verify cache version bump to `v9` and app-scoped isolation tests.
3. Stage, commit, push to `main`, and trigger Cloudflare Pages deployment to `https://voca-study-akf.pages.dev/`.
