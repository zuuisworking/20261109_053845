# Development Setup — SIGAP ULP Labuhan

> **Canonical-contract note (27 November 2026):** The API/migration contracts govern if a shorthand below differs: missing/invalid Google configuration is exposed as `503 DEPENDENCY_UNAVAILABLE`, and the HTML measurement population is **53 transformer names / 106 period objects**, reconciled to **46 names / 92 eligible period records** and **7 names / 14 unresolved period records**. See the [API contract](../api/overview.md) and [migration strategy](../database/migration.md).

Dokumen ini menjelaskan setup development yang diimplementasikan pada working tree. Gunakan Node.js `22.13.0` (sesuai `.nvmrc`/`.node-version`) untuk mereproduksi evidence lokal secara deterministik. Repository sudah memiliki test suite dan build frontend, tetapi status rilis tetap **NO-GO** sampai gate eksternal pada [implementation plan](../implementation-plan.md) ditutup. Lihat juga [Phase 0 audit](../audit/phase-0-audit.md).

## 1. Prasyarat

| Tool | Kebutuhan |
|---|---|
| Node.js | `22.13.0` untuk evidence yang disetujui; `package.json` mengizinkan `>=22.13.0` |
| npm | Toolchain npm yang sesuai dengan Node.js `22.13.0` |
| MongoDB | MongoDB `8+` lokal atau container MongoDB untuk development |
| Browser | Chrome/Edge/Firefox current dengan cookies dan developer tools |
| Source data | Akses read-only ke `.temp/sigap/` hanya untuk migrasi terkontrol |

Jangan menjalankan migrasi terhadap database produksi atau database development bersama. Gunakan database lokal/isolated dengan nama yang berbeda.

## 2. Konfigurasi environment

Salin `.env.example` ke `.env` secara lokal, kemudian isi setiap placeholder secara eksplisit. Jangan menggunakan nilai contoh yang looks like secret, jangan commit `.env`, dan jangan menyalin `.env` ke image container.

```bash
cp .env.example .env
```

Konfigurasi runtime development yang dipakai backend mencakup:

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/sigap_ulp_labuhan_development
SESSION_SECRET=<random-value-at-least-32-characters>
CLIENT_URL=http://localhost:5173
CLIENT_URLS=http://localhost:5173
GOOGLE_FORM_APPS_SCRIPT_URL=<operator-supplied-development-url-or-empty>
```

Aturan konfigurasi:

- Tidak ada production secret fallback.
- Session memakai random opaque token yang disimpan sebagai hash; tidak ada `JWT_SECRET` sebagai session authority.
- CSRF token dibuat acak per session dan hanya hash SHA-256-nya yang disimpan; runtime API tidak memerlukan secret CSRF (`CSRF_SECRET` tidak lagi dibaca backend, Compose, CI, maupun deployment).
- `GOOGLE_FORM_APPS_SCRIPT_URL` hanya dibaca backend dan tidak boleh masuk bundle frontend.
- URL Google yang kosong atau tidak valid membuat integration endpoint gagal closed dengan `503 DEPENDENCY_UNAVAILABLE`; tidak ada data fallback dan browser tidak menerima endpoint upstream.
- Production startup harus menolak placeholder, default password, dan konfigurasi development.

## 3. Instalasi dependency

```bash
npm ci
npm --prefix frontend ci
```

Gunakan lockfile yang sudah disetujui dan audit dependency sebelum menjalankan aplikasi. Workbook import memakai `exceljs@4.4.0`; transitive `uuid` di-override ke `^11.1.1`. Jalankan `npm audit` dan gate lisensi repository sebelum rilis.

## 4. Database development

Gunakan database lokal yang disposable atau terisolasi:

1. Jalankan MongoDB lokal/container.
2. Pastikan `MONGODB_URI` menunjuk database development yang disetujui.
3. Jangan menggunakan credential/URI production.
4. Hapus/m deport database development melalui prosedur eksplisit, bukan command yang dapat menyasar URI production.

MongoDB production topology dan backup/restore belum diputuskan dalam [UD-04](../implementation-plan.md#8-explicit-unresolved-decisions).

## 5. Administrator bootstrap

Administrator pertama harus dibuat melalui controlled bootstrap dengan input eksplisit. Tidak ada default username, password, email, atau credential yang dapat dipakai tanpa action operator.

Provisioning administrator awal dikendalikan CLI dan memerlukan input eksplisit:

```bash
INITIAL_ADMIN_ID=<id> \
INITIAL_ADMIN_USERNAME=<name> \
INITIAL_ADMIN_PASSWORD=<strong-password> \
npm run seed:admin
```

`INITIAL_ADMIN_EMAIL` bersifat opsional. Perintah gagal closed jika field wajib kosong/nila invalid, tidak pernah memakai password default, dan tidak mengubah akun yang sudah ada.

Jangan menyimpan password tersebut di shell history, repository, issue, screenshot, atau log.

## 6. Development server

```bash
npm run dev
```

Endpoint development:

- Backend: `http://localhost:5000`
- Frontend/Vite: `http://localhost:5173`

Backend berjalan pada `CLIENT_URL`/`CLIENT_URLS` yang dikonfigurasi. Login, CSRF, cookie, dan CORS behavior mengikuti [API contract](../api/overview.md#4-authentication-sessions-csrf-and-cors).

## 7. Migrasi ground truth

`.temp/sigap/` harus tetap read-only. Jalankan hanya pada database development/isolated dan selalu mulai dari dry-run.

Command migrasi terkontrol:

```bash
npm run migrate:trafo
npm run migrate:customers
npm run migrate:measurements
npm run migrate:transformer-name-keys
npm run migrate:all
```

Default setiap command tersebut adalah dry run. Apply memerlukan eksplisit `--apply` dan tetap harus mengikuti prosedur persetujuan di bawah.

1. Review complete diff dan mismatch report.
2. Pastikan customer CSV/XLSX equivalence pass untuk seluruh 68,742 row.
3. Pastikan transformer report sesuai 1,238 source row.
4. Pastikan measurement report menunjukkan **53 nama transformer / 106 objek periode**, **46 nama / 92 periode eligible**, dan **7 nama / 14 periode unresolved** kecuali alias sudah disetujui.
5. Apply hanya setelah approval terhadap dry-run yang direview.

Detailed rules berada pada [migration strategy](../database/migration.md).

## 8. Test dan build

```bash
npm test
npm run test:coverage
npm run lint
npm run build
```

Working tree sekarang memuat unit/integration/script test, frontend test, E2E/visual test, lint, typecheck, dan production build. Evidence aktual dan blocker eksternal dicatat pada [testing strategy](../testing/strategy.md) dan [implementation plan](../implementation-plan.md); hasil passing di lokal bukan production approval.

Test matrix minimum ada pada [implementation plan](../implementation-plan.md#5-test-matrix).

## 9. Docker lokal

Docker/Compose CLI tersedia, tetapi status daemon bergantung pada mesin developer. Untuk menjalankan container:

1. Aktifkan Docker Desktop/daemon lokal.
2. Bangun image dari `backend/Dockerfile` dan `frontend/Dockerfile` melalui `docker compose up --build -d`.
3. Root `docker-compose.yml` adalah stack HTTP lokal dan menjalankan backend dengan `NODE_ENV=development`; production tetap memakai compose/TLS serta seluruh gate di `deploy/docker-compose.prod.yml` dan [production release runbook](../operations/production-release.md).
4. Jangan memakai container development untuk mengakses production MongoDB.
5. Simpan staging/data pada volume development yang jelas, bukan `.temp/sigap/`.

Lihat [deployment architecture](../architecture/deployment.md) untuk target topology dan limitation saat ini.

## 10. Troubleshooting documentation

When documenting a defect, include:

- Request/job ID.
- Reproduction using synthetic or approved fixture data.
- Observed versus expected API envelope/error code.
- Relevant redacted logs.

Jangan menyertakan raw session/CSRF token, password, MongoDB URI, Google endpoint/credential, atau customer PII yang tidak diperlukan.
