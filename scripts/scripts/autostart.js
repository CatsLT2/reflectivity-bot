/**
 * Installs (or removes) auto-start-on-boot + auto-restart-on-crash.
 *   npm run autostart            (Windows: run terminal as Administrator / Linux: use sudo)
 *   npm run autostart:remove
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const node = process.execPath;
const remove = process.argv.includes('--remove');
const NAME = 'discord-bot';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function windows() {
  const cmdFile = path.join(root, 'start-bot.cmd');

  if (remove) {
    try { run('schtasks', ['/End', '/TN', NAME]); } catch { /* not running */ }
    run('schtasks', ['/Delete', '/TN', NAME, '/F']);
    console.log('Removed scheduled task.');
    return;
  }

  // Wrapper: restarts the bot 5s after any exit/crash and logs to logs\bot.log
  fs.writeFileSync(cmdFile, [
    '@echo off',
    'cd /d "%~dp0"',
    'if not exist logs mkdir logs',
    ':loop',
    `"${node}" src\\index.js >> logs\\bot.log 2>&1`,
    'ping -n 6 127.0.0.1 >nul',
    'goto loop',
    '',
  ].join('\r\n'));

  // Runs at boot (before anyone logs in), 30s delay so networking is up.
  run('schtasks', ['/Create', '/TN', NAME, '/TR', `"${cmdFile}"`, '/SC', 'ONSTART', '/DELAY', '0000:30', '/RU', 'SYSTEM', '/RL', 'HIGHEST', '/F']);
  run('schtasks', ['/Run', '/TN', NAME]);
  console.log(`\nInstalled. The bot now starts on boot and restarts on crash. Logs: ${path.join(root, 'logs', 'bot.log')}`);
}

function linux() {
  const unitName = `${NAME}.service`;
  const target = `/etc/systemd/system/${unitName}`;

  if (remove) {
    try { run('systemctl', ['disable', '--now', unitName]); } catch { /* ignore */ }
    if (fs.existsSync(target)) fs.unlinkSync(target);
    run('systemctl', ['daemon-reload']);
    console.log('Removed systemd service.');
    return;
  }

  const user = process.env.SUDO_USER || os.userInfo().username;
  const unit = `[Unit]
Description=Discord bot (${NAME})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${root}
ExecStart=${node} src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;

  if (process.getuid && process.getuid() !== 0) {
    const local = path.join(root, unitName);
    fs.writeFileSync(local, unit);
    console.log(`Not running as root. Unit file written to ${local}. Finish with:\n`);
    console.log(`  sudo cp ${local} ${target}`);
    console.log(`  sudo systemctl daemon-reload && sudo systemctl enable --now ${unitName}\n`);
    return;
  }

  fs.writeFileSync(target, unit);
  run('systemctl', ['daemon-reload']);
  run('systemctl', ['enable', '--now', unitName]);
  console.log(`\nInstalled. Logs: journalctl -u ${unitName} -f`);
}

try {
  if (process.platform === 'win32') windows();
  else if (process.platform === 'linux') linux();
  else console.log('Auto-start installer supports Windows and Linux. On macOS use launchd or pm2.');
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  if (process.platform === 'win32') console.error('Open your terminal as Administrator and try again.');
  process.exit(1);
}
