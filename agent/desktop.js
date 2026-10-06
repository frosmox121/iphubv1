// IPHub para escritorio: corre el servidor adentro de la app (no hace falta Node, navegador ni localhost manual).
const { app, BrowserWindow, shell } = require('electron');
const path = require('path'), net = require('net');
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
app.whenReady().then(async () => {
  const port = await free();
  process.env.PORT = String(port); process.env.IPHUB_DATA = app.getPath('userData');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'iphub-desktop-' + app.getPath('userData');
  require(path.join(__dirname, '..', 'start.js'));
  const win = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'IPHub', autoHideMenuBar: true, backgroundColor: '#0b1d3a' });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  const load = (n = 0) => win.loadURL('http://127.0.0.1:' + port).catch(() => n < 40 && setTimeout(() => load(n + 1), 250));
  load();
});
app.on('window-all-closed', () => app.quit());
