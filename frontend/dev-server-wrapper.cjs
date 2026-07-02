// Wrapper só pra preview local: garante cwd = frontend/ antes do Vite
// carregar (PostCSS/Tailwind resolvem config relativo a process.cwd()).
// Não faz parte do fluxo normal de dev (isso é `npm run dev`, que já
// roda com cwd correto por padrão) — só existe pro launch.json do
// Preview tool, que não tem opção de "cwd" no schema.
const { pathToFileURL } = require('node:url')

process.chdir(__dirname)
// Path direto de arquivo (não specifier de pacote) — evita o mapa de
// "exports" do package.json do Vite, que bloqueia require.resolve('vite/bin/vite.js').
// pathToFileURL: import() dinâmico no Windows exige file:// URL, não path cru.
const viteBinPath = __dirname + '/node_modules/vite/bin/vite.js'
process.argv = [process.argv[0], viteBinPath, '--port', '5174']
import(pathToFileURL(viteBinPath))
