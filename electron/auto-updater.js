// FunCiv has no binary release feed yet. Keep the original IPC surface, but
// never offer an upstream FunSync binary as an update to this fork.
const { BrowserWindow } = require('electron');
function initAutoUpdater() {}
function manualUpdateOnly() {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('update:error', {
      message: 'FunCiv currently uses manual source updates from ethanfel/FunCiv-player.',
    });
  }
}
module.exports = {
  initAutoUpdater,
  checkForUpdates: manualUpdateOnly,
  downloadUpdate: manualUpdateOnly,
  quitAndInstall: manualUpdateOnly,
};
