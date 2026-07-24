// Storage abstraction: uses Cloudflare R2 (S3-compatible) if its env vars
// are present, otherwise falls back to the local uploads/ folder exactly
// as before. This means local development is completely unaffected, and
// only a deployed environment with R2 configured actually uses it.
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const useR2 = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET_NAME &&
  process.env.R2_PUBLIC_URL
);

const s3Client = useR2
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

const LOCAL_UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');
const R2_PUBLIC_BASE = useR2 ? process.env.R2_PUBLIC_URL.replace(/\/$/, '') : null;

function isRemote() {
  return useR2;
}

function generateKey(prefix, originalName) {
  const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const ext = path.extname(originalName || '') || '';
  return `${prefix}/${unique}${ext}`;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Stores a buffer under a generated key and returns the URL to save on the
// record (e.g. as elements.video_url) — either a full R2 URL, or the same
// "/uploads/..." relative path the app has always used locally.
async function uploadBuffer(buffer, prefix, originalName, contentType) {
  return uploadBufferAtKey(buffer, generateKey(prefix, originalName), contentType);
}

// Same as uploadBuffer, but at a caller-chosen key instead of a random one —
// for things like QR codes, where re-generating should overwrite the same
// file (keyed by operation id) rather than piling up new ones each time.
async function uploadBufferAtKey(buffer, key, contentType) {
  if (useR2) {
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    return `${R2_PUBLIC_BASE}/${key}`;
  }

  const filePath = path.join(LOCAL_UPLOADS_ROOT, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return `/uploads/${key}`;
}

// Reads back the raw bytes for a URL previously returned by uploadBuffer —
// used e.g. to embed a QR code image into the printable PDF.
async function getBuffer(fileUrl) {
  if (useR2 && fileUrl.startsWith(R2_PUBLIC_BASE)) {
    const key = fileUrl.slice(R2_PUBLIC_BASE.length + 1);
    const result = await s3Client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    return streamToBuffer(result.Body);
  }
  const relative = fileUrl.replace(/^\//, '');
  return fs.readFileSync(path.join(__dirname, '..', relative));
}

// Deletes a previously-stored file (old video version, replaced style photo, etc).
async function deleteFile(fileUrl) {
  if (!fileUrl) return;

  if (useR2 && fileUrl.startsWith(R2_PUBLIC_BASE)) {
    const key = fileUrl.slice(R2_PUBLIC_BASE.length + 1);
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    } catch (err) {
      console.error('R2 delete failed:', err);
    }
    return;
  }

  const relative = fileUrl.replace(/^\//, '');
  const filePath = path.join(__dirname, '..', relative);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { isRemote, uploadBuffer, uploadBufferAtKey, getBuffer, deleteFile };
