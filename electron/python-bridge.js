const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const log = require('./logger');

let pythonProcess = null;
let backendPort = 5124;

// --- Health monitor ---
//
// The backend is launched at app startup but can die mid-session
// (Python crash, OOM, user killed it from Task Manager, FastAPI worker
// hung, etc.). Pre-2026-04-28 this surfaced as silent IPC failures —
// thumbnails stopped loading, library scans failed, but the user got
// no signal that the cause was the backend dying. Now we poll the
// `/health` endpoint and notify the renderer on state changes so it
// can surface a banner with a Restart action.
//
// Polling cadence: 5 s (fast enough that the user sees the banner
// within ~10 s of a death; slow enough that a steady-state idle app
// doesn't spend cycles on health checks).
//
// Failure threshold: 2 consecutive failures = `down`. A single failure
// might be a transient timeout under load. Two in a row at 5 s spacing
// is a real death.
const HEALTH_INTERVAL_MS = 5000;
const HEALTH_TIMEOUT_MS = 3000;
const HEALTH_FAIL_THRESHOLD = 2;

/**
 * Sentinel carried in the health 'detail' when the bundled backend
 * executable is missing from a packaged install. The renderer shows a
 * specific, actionable message for this instead of a generic timeout —
 * 'reinstall / check antivirus' is something a non-technical user can act
 * on, 'backend is not responding' is not.
 */
const BACKEND_MISSING = 'backend-executable-missing';

let backendMissing = false;
let healthDetail = null;
let healthState = 'unknown';   // 'unknown' | 'running' | 'down' | 'restarting'
let healthConsecutiveFailures = 0;
let healthIntervalHandle = null;
let healthListener = null;     // callback: (state, detail) => void

async function startBackend({ reusePort = false } = {}) {
  if (pythonProcess) return;
  const selectedPort = await require('./owned-backend-port').availablePort(backendPort);
  if (reusePort && selectedPort !== backendPort) throw new Error('The backend port was taken by another process. Restart FunCiv to choose a new port.');
  backendPort = selectedPort;

  return new Promise((resolve, reject) => {
    const fs = require('fs');
    const backendDir = path.join(__dirname, '..', 'backend');

    // In packaged app, look for the bundled executable in resources/backend
    const electronApp = require('electron').app;
    const isPackaged = electronApp.isPackaged;
    const bundledBackend = isPackaged
      ? path.join(process.resourcesPath, 'backend', 'funsync-backend' + (process.platform === 'win32' ? '.exe' : ''))
      : null;

    // userData dir holds config.json — the web-remote locale endpoint
    // reads this file to mirror the desktop's chosen language onto the
    // phone without an extra picker. Optional — backend falls back to
    // 'en' if not provided.
    const userDataDir = electronApp.getPath('userData');

    let cmd, args, cwd;

    // A PACKAGED build must never fall through to the developer path.
    //
    // 4wen's log, 2026-08-13: `Failed to start Python backend: spawn python
    // ENOENT`. The installed app could not find its bundled backend, quietly
    // dropped into the ELSE branch below — which is meant for running from a
    // source checkout — and tried to spawn `python` off the PATH. He has no
    // Python installed, because he should not need any, so it failed with an
    // error that means nothing to him and the app simply said "backend is
    // not responding" forever. Restart could never work either: it took the
    // same path every time.
    //
    // The executable going missing after a successful install is almost
    // always ANTIVIRUS QUARANTINE — PyInstaller one-file executables are a
    // long-standing false positive, which is why this project already builds
    // with `upx=False`. It can also be a partial or corrupted install.
    //
    // Either way it is an installation fault, not a runtime one, and the
    // user needs telling that rather than being shown a generic timeout.
    if (isPackaged && (!bundledBackend || !fs.existsSync(bundledBackend))) {
      log.error(`[Backend] Bundled executable NOT FOUND at: ${bundledBackend}`);
      log.error('[Backend] The app is packaged, so this file should exist. Most likely it was '
        + 'quarantined by antivirus after install, or the install is incomplete.');
      log.error('[Backend] NOT falling back to a system Python — that is a development-only path '
        + 'and would fail with a misleading "spawn python ENOENT".');
      backendMissing = true;
      _emitHealthState('down', BACKEND_MISSING);
      resolve();   // the app still runs; playback does not need the backend
      return;
    }

    if (bundledBackend && fs.existsSync(bundledBackend)) {
      // Production: use PyInstaller-bundled executable
      cmd = bundledBackend;
      args = ['--port', String(backendPort), '--host', '127.0.0.1', '--user-data-dir', userDataDir];
      cwd = path.dirname(bundledBackend);
    } else {
      // Development: use venv Python or system Python
      const venvPython = process.platform === 'win32'
        ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
        : path.join(backendDir, '.venv', 'bin', 'python');

      cmd = process.env.FUNCIV_PYTHON || (fs.existsSync(venvPython)
        ? venvPython
        : (process.platform === 'win32' ? 'python' : 'python3'));
      args = ['main.py', '--port', String(backendPort), '--host', '127.0.0.1', '--user-data-dir', userDataDir];
      cwd = backendDir;
    }

    pythonProcess = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // detached on Linux for process group kill
    });

    let started = false;

    const ownedProcess = pythonProcess;
    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      log.info(`[Backend] ${output}`);
      if (!started && output.includes('Uvicorn running')) {
        started = true;
        resolve();
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      const output = data.toString();
      log.error(`[Backend] ${output}`);
      // Uvicorn logs startup to stderr
      if (!started && output.includes('Uvicorn running')) {
        started = true;
        resolve();
      }
    });

    pythonProcess.on('error', (err) => {
      log.error('Failed to start Python backend:', err.message);
      if (!started) {
        started = true;
        // Don't reject — app can still work without backend for basic playback
        resolve();
      }
    });

    pythonProcess.on('close', (code) => {
      log.info(`Python backend exited with code ${code}`);
      if (pythonProcess === ownedProcess) pythonProcess = null;
      if (!started) {
        started = true;
        resolve();
      }
    });

    // Timeout — don't block app startup forever
    setTimeout(() => {
      if (!started) {
        started = true;
        log.warn('Python backend startup timed out, continuing without it');
        resolve();
      }
    }, 10000);
  });
}

function stopBackend() {
  stopHealthMonitor();
  if (pythonProcess) {
    const pid = pythonProcess.pid;
    try {
      // On Windows, .kill() sends SIGTERM which PyInstaller exes can ignore.
      // Use taskkill /T to kill the process tree (includes child processes).
      if (process.platform === 'win32' && pid) {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      } else if (pid) {
        // Kill process group on Linux (spawned with detached: true)
        process.kill(-pid, 'SIGTERM');
      }
    } catch {
      // Process may already be dead
    }
    pythonProcess = null;
  }


}

function getBackendPort() {
  return backendPort;
}

/**
 * Subscribe to backend health state transitions. The callback fires on
 * every state change with `(state, detail)` where state is one of
 * `'running'`, `'down'`, `'restarting'`. main.js sets this up to
 * forward events to all renderer windows via IPC.
 */
function setHealthListener(cb) {
  healthListener = cb || null;
}

function getHealthState() {
  return healthState;
}

/**
 * Why the backend is down, when we know something more specific than
 * "it stopped answering" — currently the BACKEND_MISSING sentinel.
 *
 * Read at first paint as well as pushed on transitions: the renderer
 * subscribes AFTER startBackend() has already run, so a reason emitted
 * during startup would otherwise be lost and the user would get the
 * generic timeout message instead of "reinstall / check antivirus".
 */
function getHealthDetail() {
  return healthDetail;
}

/** True when a packaged install is missing its backend executable. */
function isBackendMissing() {
  return backendMissing;
}

/**
 * Single non-blocking GET to /health. Resolves with `true` on 200,
 * `false` on any other outcome (network error, timeout, non-2xx).
 */
function probeHealth() {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: backendPort,
      path: '/health',
      method: 'GET',
      timeout: HEALTH_TIMEOUT_MS,
    }, (res) => {
      // Drain response body — leaving it open holds the socket.
      res.on('data', () => { /* ignore */ });
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function _emitHealthState(newState, detail) {
  if (newState === healthState) return; // no-op when state didn't change
  healthState = newState;
  healthDetail = detail || null;
  log.info(`[Backend] health state → ${newState}${detail ? ` (${detail})` : ''}`);
  if (healthListener) {
    try { healthListener(newState, detail); }
    catch (err) { log.warn('[Backend] health listener threw:', err.message); }
  }
}

function startHealthMonitor() {
  stopHealthMonitor(); // idempotent
  healthConsecutiveFailures = 0;
  healthIntervalHandle = setInterval(async () => {
    const ok = await probeHealth();
    if (ok) {
      healthConsecutiveFailures = 0;
      _emitHealthState('running');
    } else {
      healthConsecutiveFailures++;
      if (healthConsecutiveFailures >= HEALTH_FAIL_THRESHOLD) {
        _emitHealthState('down', `no /health response in ${healthConsecutiveFailures} attempts`);
      }
    }
  }, HEALTH_INTERVAL_MS);
}

function stopHealthMonitor() {
  if (healthIntervalHandle) {
    clearInterval(healthIntervalHandle);
    healthIntervalHandle = null;
  }
}

/**
 * Stop the existing backend (if any) and start a new one. Used by the
 * "Restart Backend" affordance in the disconnected banner. Emits
 * `'restarting'` immediately so the UI can show transitional state.
 */
async function restartBackend() {
  _emitHealthState('restarting', 'user-initiated');
  stopHealthMonitor();
  const ownedProcess = pythonProcess;
  const closed = ownedProcess && ownedProcess.exitCode === null
    ? new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The previous backend is still shutting down. Try again shortly.')), 5000);
      ownedProcess.once('close', () => { clearTimeout(timer); resolve(); });
    }) : Promise.resolve();
  stopBackend();
  await closed;
  // Renderer services retain this port for the lifetime of the window.
  await startBackend({ reusePort: true });
  startHealthMonitor();
  // First probe after restart — if it succeeds, the next interval tick
  // will emit 'running'. If it fails, threshold logic kicks in.
  const ok = await probeHealth();
  if (ok) {
    healthConsecutiveFailures = 0;
    _emitHealthState('running');
  }
}

module.exports = {
  startBackend,
  stopBackend,
  getBackendPort,
  setHealthListener,
  getHealthState,
  getHealthDetail,
  isBackendMissing,
  BACKEND_MISSING,
  startHealthMonitor,
  stopHealthMonitor,
  restartBackend,
};
