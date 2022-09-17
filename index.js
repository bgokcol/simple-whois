const net = require('net');
const fs = require('fs');
const https = require('https');

var tldCache = {};
if (fs.existsSync(__dirname + '/tlds.json')) {
    tldCache = JSON.parse(fs.readFileSync(__dirname + '/tlds.json'));
}

exports.getWhoisServer = async (tld) => {
    tld = tld.toLowerCase();
    if (typeof tldCache[tld] !== 'undefined') {
        return tldCache[tld];
    }
    else {
        let page = await new Promise((resolve, reject) => {
            let req = https.request({
                hostname: 'www.iana.org',
                port: 443,
                path: `/domains/root/db/${tld}.html`,
                method: 'GET',
                headers: {
                    'User-Agent': 'default/1.0'
                }
            }, (res) => {
                res.setEncoding('utf8');
                let responseBody = '';
                res.on('data', (chunk) => {
                    responseBody += chunk;
                });
                res.on('end', () => {
                    resolve(responseBody);
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.end();
        });
        if (page.includes('This page does not exist')) {
            return null;
        }
        else {
            let whoisServer = page.match(/\<b\>WHOIS Server:\<\/b\>(.*)/g);
            if (whoisServer !== null) {
                whoisServer = whoisServer[0].replace(/\<\/?[^>]+\>/g, '').split(':');
                if (whoisServer.length <= 1) {
                    return null;
                }
                whoisServer = whoisServer[1].trim();
                tldCache[tld] = whoisServer;
                fs.writeFileSync('./tlds.json', JSON.stringify(tldCache));
            }
            return whoisServer;
        }
    }
}

exports.getRawWhois = async (domain, server, port) => {
    return new Promise((resolve, reject) => {
        let data = '';
        let socket = net.createConnection(port, server, () => {
            let query = domain;
            if (server == 'whois.verisign-grs.com') {
                query = '=' + query;
            }
            socket.write(`${query}\r\n`, 'ascii');
        });
        socket.setEncoding('utf-8');
        socket.on('data', function (response) {
            data = data + response;
        }).on('close', function (error) {
            if (error) data = 'Could not fetch whois data';
            return resolve(data);
        });
    });
}

exports.getWhois = async function (domain, config = {}) {
    if (config.hasOwnProperty('tld') && config.tld !== null && config.tld !== '') {
        tld = config.tld;
    }
    else {
        tld = domain.split('.').pop();
    }
    let whoisServers = [];
    let whoisServer = (config.hasOwnProperty('whoisServer') && config.whoisServer !== null && config.whoisServer !== '') ? config.whoisServer : await this.getWhoisServer(tld);
    if (whoisServer === null) {
        return null;
    }
    whoisServer = /^(http(s?)):\/\//i.test(whoisServer) ? (new URL(whoisServer)).hostname : whoisServer;
    whoisServers.push(whoisServer);
    let data = await this.getRawWhois(domain, whoisServer, 43);
    if (!config.hasOwnProperty('deepWhois') || config.deepWhois) {
        let regWhoisServer = data.match(/Registrar WHOIS Server: (.*)/g);
        while (regWhoisServer !== null) {
            regWhoisServer = regWhoisServer[0].replace(/Registrar WHOIS Server: /g, '').trim();
            regWhoisServer = /^(http(s?)):\/\//i.test(regWhoisServer) ? (new URL(regWhoisServer)).hostname : regWhoisServer;
            if (whoisServers.includes(regWhoisServer)) {
                break;
            }
            data = await this.getRawWhois(domain, regWhoisServer, 43);
            whoisServers.push(regWhoisServer);
            regWhoisServer = data.match(/Registrar WHOIS Server: (.*)/g);
        }
    }
    return data;
}