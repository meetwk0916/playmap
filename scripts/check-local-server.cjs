const { randomUUID } = require('node:crypto');
const { writeFile, rm } = require('node:fs/promises');
const path = require('node:path');

async function checkServer(url) {
  const origin = new URL(url).origin;
  const name = '.playmap-probe-' + randomUUID();
  const file = path.join(__dirname, '..', name);
  await writeFile(file, name, { flag: 'wx' });
  try {
    let response;
    try {
      response = await fetch(new URL(name, url), { signal: AbortSignal.timeout(2000) });
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return false;
      throw new Error(origin + ' 上的服务无响应；请检查并停止占用进程。', { cause: error });
    }
    if (!response.ok || await response.text() !== name) {
      throw new Error(origin + ' 正在服务另一份工作目录；请检查并停止占用进程。');
    }
    return true;
  } finally {
    await rm(file);
  }
}

module.exports = async function (config) {
  const url = config.projects[0].use.baseURL;
  if (!await checkServer(url)) throw new Error(url + ' 本地服务尚未启动。');
};

if (require.main === module) {
  checkServer('http://127.0.0.1:4173/').then(running => {
    if (running) throw new Error('当前工作目录已在 4173 运行；直接打开页面即可。');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
