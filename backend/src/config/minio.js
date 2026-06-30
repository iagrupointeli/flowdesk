import * as Minio from 'minio'

export const minioClient = new Minio.Client({
  endPoint:  process.env.MINIO_ENDPOINT,
  port:      Number(process.env.MINIO_PORT) || 9000,
  useSSL:    process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ROOT_USER,
  secretKey: process.env.MINIO_ROOT_PASSWORD,
})

export const BUCKET = process.env.MINIO_BUCKET
// Lógica de negócio (presigned URLs, upload, delete) → src/services/storage.service.js
