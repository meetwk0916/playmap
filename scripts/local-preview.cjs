const port = process.env.PLAYMAP_PORT || '4173';
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('PLAYMAP_PORT 必须是 1 到 65535 之间的整数。');
}

module.exports = `http://127.0.0.1:${Number(port)}/`;
