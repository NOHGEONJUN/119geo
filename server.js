const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3000;

// MIME 타입 매핑 (UTF-8 charset 포함)
const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);

    // URL 파싱
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    // 파일 확장자 추출
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    // 텍스트 파일인지 바이너리 파일인지 판단
    const isTextFile = contentType.includes('text/') || 
                       contentType.includes('application/json') ||
                       contentType.includes('javascript');

    // 파일 읽기 (텍스트는 UTF-8, 바이너리는 그대로)
    const encoding = isTextFile ? 'utf8' : null;
    
    fs.readFile(filePath, encoding, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>404 - 파일을 찾을 수 없습니다</h1>', 'utf-8');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`서버 오류: ${error.code}`, 'utf-8');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            if (isTextFile) {
                res.end(content, 'utf-8');
            } else {
                res.end(content);
            }
        }
    });
});

server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`서버가 ${url} 에서 실행 중입니다.`);
    console.log('브라우저를 자동으로 엽니다...');
    
    // 플랫폼별 브라우저 열기 명령어
    let command;
    const platform = process.platform;
    
    if (platform === 'win32') {
        // Windows
        command = `start ${url}`;
    } else if (platform === 'darwin') {
        // macOS
        command = `open ${url}`;
    } else {
        // Linux 및 기타
        command = `xdg-open ${url}`;
    }
    
    // 브라우저 자동 실행
    exec(command, (error) => {
        if (error) {
            console.log(`브라우저를 자동으로 열 수 없습니다. 수동으로 ${url} 을 열어주세요.`);
        } else {
            console.log(`브라우저가 열렸습니다: ${url}`);
        }
    });
});

