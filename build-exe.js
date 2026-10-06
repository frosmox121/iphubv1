const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const root = __dirname, dir = path.join(root, 'agent');
process.chdir(dir);
function run(cmd) {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
  return r.status == null ? 1 : r.status;
}
const ok = () => fs.existsSync(path.join('node_modules', 'electron', 'package.json')) && fs.existsSync(path.join('node_modules', '@electron', 'packager'));
if (!ok()) {
  try { fs.rmSync('node_modules', { recursive: true, force: true }); } catch (_) {}
  console.log('\n[1/3] Instalando solo electron y packager (si dice ENOSPC, falta espacio en el disco)…\n');
  if (run('npm install --include=dev --no-save electron@31 @electron/packager --no-fund --no-audit') !== 0) {
    console.error('\nNo se pudo instalar. Si viste ENOSPC, el disco esta lleno: borra agent\\node_modules y vacia la papelera, despues volve a ejecutar.');
    process.exit(1);
  }
  if (!ok()) { console.error('\nLa instalacion termino pero falta electron. Proba: borrar agent\\node_modules y ejecutar de nuevo (revisa tu conexion/antivirus, electron descarga ~100 MB).'); process.exit(1); }
} else console.log('[1/3] Electron ya esta instalado');
console.log('\n[2/3] Armando IPHub.exe…\n');
const iconArg = fs.existsSync(path.join(dir, 'icon.ico')) ? ' --icon=icon.ico' : '';
if (run('npx @electron/packager . IPHub --platform=win32 --arch=x64 --out=dist --overwrite --executable-name=IPHub --asar' + iconArg) !== 0) {
  console.error('\nFallo el empaquetado.'); process.exit(1);
}
const exe = path.join(dir, 'dist', 'IPHub-win32-x64', 'IPHub.exe');
if (!fs.existsSync(exe)) { console.error('No aparecio el exe'); process.exit(1); }
console.log('\nLISTO: agent\\dist\\IPHub-win32-x64\\IPHub.exe\n');
