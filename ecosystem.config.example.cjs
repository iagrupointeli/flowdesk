// Template versionado — copie para ecosystem.config.cjs e preencha os
// valores reais. O arquivo real (com segredos) NUNCA deve ser commitado.
//
// Em produção, o frontend é build estático servido pelo Apache/nginx do
// servidor (proxy reverso de /api pra essa porta) — não roda Vite via PM2.
module.exports = {
  apps: [
    {
      name: 'flowdesk-backend',
      cwd: __dirname + '/backend',
      script: 'src/index.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
        POSTGRES_HOST: 'localhost',
        POSTGRES_PORT: '5432',
        POSTGRES_DB: 'flowdesk',
        POSTGRES_USER: 'flowdesk_user',
        POSTGRES_PASSWORD: 'change_me_postgres',
        MINIO_ENDPOINT: 'localhost',
        MINIO_PORT: '9000',
        MINIO_USE_SSL: 'false',
        MINIO_ROOT_USER: 'flowdesk_minio',
        MINIO_ROOT_PASSWORD: 'change_me_minio',
        MINIO_BUCKET: 'flowdesk-attachments',
        JWT_ACCESS_SECRET: 'change_me_access_secret_min_32_chars',
        JWT_REFRESH_SECRET: 'change_me_refresh_secret_min_32_chars',
        JWT_ACCESS_EXPIRES: '1h',
        JWT_REFRESH_EXPIRES: '7d',
        PORT: '3001',
        FRONTEND_URL: 'https://change-me.grupointeli.com.br',
        TZ: 'UTC',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'no-reply@example.com',
        SMTP_PASS: 'change_me_smtp',
        SMTP_FROM: 'FlowDesk <no-reply@example.com>',
      },
    },
  ],
};
