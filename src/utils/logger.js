const color = process.stdout.isTTY;
const codes = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m' };

module.exports = (scope = 'bot') => {
  const out = (level, ...args) => {
    const tag = level.toUpperCase().padEnd(5);
    const lvl = color ? `${codes[level]}${tag}${codes.reset}` : tag;
    (level === 'error' ? console.error : console.log)(`${new Date().toISOString()} ${lvl} [${scope}]`, ...args);
  };
  return {
    info: (...a) => out('info', ...a),
    warn: (...a) => out('warn', ...a),
    error: (...a) => out('error', ...a),
  };
};
