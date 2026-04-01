const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
process.env.PROJECT_ROOT = projectRoot;
process.chdir(projectRoot);
require('dotenv').config();
require('ts-node').register({ project: path.join(projectRoot, 'scripts', 'tsconfig.json') });
const { fetchLatestDates, runUpdate, LOTTERY_LABELS } = require('../scripts/monitor-core');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 520,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'LottoPilot 数据监控',
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('check', async () => ({ status: await fetchLatestDates(), labels: LOTTERY_LABELS }));
ipcMain.handle('update', async () => runUpdate());
