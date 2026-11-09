# Walker document storage (Milestone 7)

Walker vetting documents (CI front/back, selfie, background certificate,
optional intro video) live in **private** object storage. Nothing is ever
public:

- The walker's phone compresses photos (≤1600 px JPEG), asks
  `POST /api/walkers/me/documents` for a **10-minute presigned PUT**, and
  uploads straight to the bucket. `POST …/[id]/complete` makes the server
  check the object (exists, type, size) before it counts.
- Admins open documents from **Solicitudes → Revisar verificación**, through
  **5-minute presigned GET** links. Every opening is written to the audit log
  (`WALKER_DOCS_VIEWED`).
- The CI number is AES-256-GCM encrypted (`ID_ENCRYPTION_KEY`); only its
  last 4 digits are stored in clear and shown anywhere.

Approval (`PATCH /api/admin/walkers/[id]` `approve`) is refused until all four
required documents, the CI number and the four checklist items are done.

## Production: Cloudflare R2

1. **Create the bucket.** Cloudflare dashboard → R2 → *Create bucket*, e.g.
   `firuwalk-walker-docs`. Location: automatic. Leave **public access off**
   (no r2.dev subdomain, no custom domain).
2. **CORS** (the browser uploads directly to R2). Bucket → *Settings* →
   *CORS policy*:

   ```json
   [
     {
       "AllowedOrigins": ["https://firu-walk.vercel.app"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Add your custom domain to `AllowedOrigins` when you have one.
3. **API token.** R2 → *Manage R2 API Tokens* → *Create API token* →
   permission **Object Read & Write**, scoped to this bucket only. Copy the
   Access Key ID and Secret Access Key (shown once).
4. **Vercel env vars** (Production, and Preview if previews should upload):

   | Variable | Value |
   | --- | --- |
   | `STORAGE_PROVIDER` | `s3` |
   | `STORAGE_BUCKET` | `firuwalk-walker-docs` |
   | `STORAGE_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
   | `STORAGE_REGION` | `auto` |
   | `STORAGE_ACCESS_KEY_ID` | from step 3 |
   | `STORAGE_SECRET_ACCESS_KEY` | from step 3 (mark *Sensitive*) |

5. Redeploy. Until these are set, the walker app shows "document upload
   will be available very soon" and nothing breaks.

`ID_ENCRYPTION_KEY` is already required in production (`openssl rand -base64 32`).
**Never rotate it casually**: stored CI numbers can't be decrypted with a new
key (the `v1:` prefix leaves room for a re-encryption migration).

## Other providers

The adapter (`src/lib/server/storage/s3Provider.ts`) speaks the S3 API, so
AWS S3, Supabase Storage (S3 endpoint) or MinIO work by changing only the
env vars above.

## Development and tests

With `STORAGE_PROVIDER` unset outside production, the **mock** provider stores
files under the OS temp dir (`MOCK_STORAGE_DIR` to override) and serves them
through `/api/storage/mock` with HMAC-signed, expiring tokens — the same
contract as real presigned URLs. It is refused on the production deployment.
