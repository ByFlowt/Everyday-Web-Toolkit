// Tiny local preview server: serves only _site/ on 127.0.0.1.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = fileURLToPath(new URL('../_site', import.meta.url));
const TYPES = Object.freeze({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
});

function isInside(root, file) {
    const path = relative(root, file);
    return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

// Maps a request URL to a file below root, or null if it must not be served.
export function resolveRequestPath(root, requestUrl) {
    let pathname;
    try {
        pathname = decodeURIComponent(requestUrl.split(/[?#]/, 1)[0]);
    } catch {
        return null;
    }
    if (!pathname.startsWith('/') || /[\0\\:]/.test(pathname) || pathname.split('/').includes('..')) {
        return null;
    }
    const file = join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    return isInside(root, file) ? file : null;
}

export function createStaticServer(root = SITE) {
    const base = resolve(root);
    return createServer(async (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { Allow: 'GET, HEAD' }).end();
            return;
        }
        try {
            const file = resolveRequestPath(base, request.url);
            const type = file && TYPES[extname(file)];
            // realpath also rejects links that point outside the site.
            if (!type || !isInside(await realpath(base), await realpath(file))) {
                throw new Error('not served');
            }
            const content = await readFile(file);
            response.writeHead(200, {
                'Content-Type': type,
                'Content-Length': content.length,
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff'
            });
            response.end(request.method === 'HEAD' ? undefined : content);
        } catch {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        }
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT) || 8080;
    createStaticServer().listen(port, '127.0.0.1', () => {
        console.log(`Serving _site/ at http://127.0.0.1:${port}/ (run "npm run build" first)`);
    });
}
