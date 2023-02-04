import path from 'path';
import http from 'http';
import https from 'https';
import fs from 'fs';
import url from 'url';
import child_process from 'child_process';

import express from 'express';
import * as vite from 'vite';

import {
  AiServer,
} from './src/servers/ai-server.js';
import {
  YoutubeServer,
} from './src/servers/youtube-server.js';

//

const isProduction = process.env.NODE_ENV === 'production';
const vercelJson = JSON.parse(fs.readFileSync('./vercel.json', 'utf8'));

const SERVER_NAME = 'local.webaverse.com';

const SERVER_PORT = parseInt(process.env.PORT, 10) || 9999;
const MULTIPLAYER_PORT = 2222;

//

const aiServer = new AiServer();
const youtubeServer = new YoutubeServer();

//

class DatabaseServer {
  constructor() {
    const cp = child_process.spawn(path.join(
      'target',
      'release',
      'qdrant',
    ), [], {
      cwd: path.join(
        'bin',
        'qdrant',
      ),
    });
    cp.stdout.pipe(process.stdout);
    cp.stderr.pipe(process.stderr);
    cp.on('error', err => {
      console.warn(err.stack);
    });
    this.cp = cp;
  }
  destroy() {
    this.cp.kill();
  }
}
const databaseServer = new DatabaseServer();
process.on('exit', () => {
  databaseServer.destroy();
});

//

class MultiplayerServer {
  //  You can load the multiplayer-do example app to check that the server is running: http://127.0.0.1:2222/
  constructor() {
    const dirname = path.dirname(import.meta.url.replace(/^file:\/\//, ''));

    const multiplayerPath = path.join(dirname, 'packages', 'multiplayer-do');
    const wranglerPath = path.join(dirname, 'node_modules', 'wrangler');
    const cp = child_process.spawn(
      process.argv[0],
      [wranglerPath, 'dev', '-l', '--port', MULTIPLAYER_PORT + ''],
      {
        cwd: multiplayerPath,
        env: {
          ...process.env,
          PORT: MULTIPLAYER_PORT,
        },
      }
    );

    cp.stdout.pipe(process.stdout);
    cp.stderr.pipe(process.stderr);
    cp.on('error', err => {
      console.warn(err.stack);
    });
    this.cp = cp;
  }
  destroy() {
    this.cp.kill();
  }
}
const multiplayerServer = new MultiplayerServer();
process.on('exit', () => {
  multiplayerServer.destroy();
});

//

const _tryReadFile = p => {
  try {
    return fs.readFileSync(p);
  } catch(err) {
    // console.warn(err);
    return null;
  }
};
const certs = {
  key: _tryReadFile('./certs/privkey.pem') || _tryReadFile('./certs-local/privkey.pem'),
  cert: _tryReadFile('./certs/fullchain.pem') || _tryReadFile('./certs-local/fullchain.pem'),
};
const tmpDir = `/tmp/webaverse-dev-server`;
fs.mkdirSync(tmpDir, {
  recursive: true,
});

//

const {headers: headerSpecs} = vercelJson;
const headerSpec0 = headerSpecs[0];
const {headers} = headerSpec0;
const _setHeaders = res => {
  for (const {key, value} of headers) {
    res.setHeader(key, value);
  }
};

//

const _proxyTmp = (req, res) => {
  const o = url.parse(req.url);
  const p = path.join(tmpDir, o.path.replace(/^\/tmp\//, ''));

  // console.log('got tmp request', req.method, req.url, p);

  if (req.method === 'GET') {
    const rs = fs.createReadStream(p);
    rs.on('error', err => {
      console.warn(err);
      res.statusCode = 500;
      res.end(err.stack);
    });
    rs.pipe(res);
  } else if (['PUT', 'POST'].includes(req.method)) {
    const ws = fs.createWriteStream(p);
    ws.on('error', err => {
      console.warn(err);
      res.statusCode = 500;
      res.end(err.stack);
    });
    ws.on('finish', () => {
      res.end();
    });
    req.pipe(ws);
  } else if (req.method === 'OPTIONS') {
    res.end();
  } else {
    res.statusCode = 400;
    res.end('not implemented');
  }
};

// main

(async () => {
  const app = express();
  app.all('*', async (req, res, next) => {
    _setHeaders(res);

    if (req.url.startsWith('/tmp/')) {
      _proxyTmp(req, res);
    } else if ([
      '/api/ai/',
      '/api/image-ai/',
    ].some(prefix => req.url.startsWith(prefix))) {
      await aiServer.handleRequest(req, res);
    } else if ([
      '/api/youtube/',
    ].some(prefix => req.url.startsWith(prefix))) {
      await youtubeServer.handleRequest(req, res);
    } else {
      next();
    }
  });

  const isHttps = !process.env.HTTP_ONLY && (!!certs.key && !!certs.cert);
  // const wsPort = SERVER_PORT + 1;

  const _makeHttpServer = () => isHttps ? https.createServer(certs, app) : http.createServer(app);
  const httpServer = _makeHttpServer();
  const viteServer = await vite.createServer({
    mode: isProduction ? 'production' : 'development',
    // root: process.cwd(),
    server: {
      middlewareMode: true,
      // force: true,
      hmr: {
        server: httpServer,
        port: SERVER_PORT,
        // overlay: false,
      },
    },
    // appType: 'custom',
  });
  app.use(viteServer.middlewares);
  
  await new Promise((accept, reject) => {
    httpServer.listen(SERVER_PORT, '0.0.0.0', () => {
      accept();
    });
    httpServer.on('error', reject);
  });
  // console.log('pid', process.pid);
  console.log(`  > Local: http${isHttps ? 's' : ''}://${SERVER_NAME}:${SERVER_PORT}/`);
})();

process.on('disconnect', function() {
  console.log('dev-server parent exited')
  process.exit();
});
process.on('SIGINT', function() {
  console.log('dev-server SIGINT')
  process.exit();
});
