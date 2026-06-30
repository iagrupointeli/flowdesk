import { minioClient, BUCKET } from '#config/minio.js'

const PRESIGN_TTL_SECONDS = 60 * 60 // 1 hora

/**
 * Gera uma presigned URL de download para um objeto no MinIO.
 * TTL: 1h. Nunca exponha o objectName como path público.
 */
export function presignedDownloadUrl(objectName) {
  return minioClient.presignedGetObject(BUCKET, objectName, PRESIGN_TTL_SECONDS)
}

/**
 * Faz stream de um arquivo diretamente para o MinIO sem passar por disco ou RAM.
 * @param {string} objectName - UUID do objeto (sem demand_id na chave)
 * @param {import('stream').Readable} stream - Stream do arquivo
 * @param {number} size - Tamanho em bytes
 * @param {string} mimeType - MIME type validado via magic bytes
 */
/**
 * Faz stream de um arquivo diretamente para o MinIO sem passar por disco ou RAM.
 * @param {string} objectName - UUID do objeto
 * @param {import('stream').Readable} stream - Stream do arquivo
 * @param {string} mimeType - MIME type validado via magic bytes
 * @param {number|null} [size] - Tamanho em bytes. Se null/undefined, usa multipart automático.
 */
export function uploadStream(objectName, stream, mimeType, size) {
  // sem tag "confirmed" ainda — lifecycle policy remove em 24h se não confirmado
  const metaData = { 'Content-Type': mimeType }
  if (size != null) {
    return minioClient.putObject(BUCKET, objectName, stream, size, metaData)
  }
  // minio v8: omitir size → minio detecta e usa multipart quando necessário
  return minioClient.putObject(BUCKET, objectName, stream, metaData)
}

/**
 * Marca um objeto como confirmado após o COMMIT da transação do banco.
 * Objetos sem essa tag são deletados pela Lifecycle Policy em 24h.
 */
export function confirmObject(objectName) {
  return minioClient.setObjectTagging(BUCKET, objectName, { confirmed: 'true' })
}

/**
 * Remove um objeto do MinIO (rollback de upload em caso de falha).
 */
export function deleteObject(objectName) {
  return minioClient.removeObject(BUCKET, objectName)
}

/**
 * Baixa um objeto do MinIO inteiro em memória (Buffer).
 * Uso restrito a arquivos pequenos/médios (fotos de checking para o PDF) —
 * NÃO usar para anexos genéricos, que devem ir por presigned URL.
 */
export async function getObjectBuffer(objectName) {
  const stream = await minioClient.getObject(BUCKET, objectName)
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}
