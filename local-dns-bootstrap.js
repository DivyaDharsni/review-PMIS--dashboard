'use strict';

// PMIS_DNS_BOOTSTRAP_LOAD_ENV_V1
// This file is preloaded with node -r, so it must load .env itself
// before reading PMIS_DNS_SERVERS.
try {
    require('dotenv').config({
        path: require('path').join(__dirname, '.env')
    });
} catch (error) {
    console.warn(
        '[PMIS LOCAL DNS] Could not preload .env:',
        error && error.message ? error.message : error
    );
}
/*
 * PMIS LOCAL MONGODB DNS RECOVERY
 * --------------------------------
 * LOCAL ONLY.
 *
 * 1. Forces Node to try public DNS for MongoDB Atlas SRV/TXT records.
 * 2. If the network refuses direct SRV/TXT DNS queries, falls back to
 *    DNS-over-HTTPS.
 * 3. Does NOT modify database data.
 * 4. Does NOT affect production.
 */

const dns = require('node:dns');

const configured =
    String(
        process.env.PMIS_DNS_SERVERS ||
        '8.8.8.8,1.1.1.1'
    )
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

try {
    dns.setServers(configured);

    console.log(
        '[PMIS LOCAL DNS] Resolver:',
        dns.getServers()
    );
}
catch (error) {
    console.warn(
        '[PMIS LOCAL DNS] Could not set resolver:',
        error.message
    );
}


const promises = dns.promises;

const nativeResolveSrv =
    promises.resolveSrv.bind(promises);

const nativeResolveTxt =
    promises.resolveTxt.bind(promises);


function isMongoAtlasName(name) {
    return String(name || '')
        .toLowerCase()
        .includes('mongodb.net');
}


async function dnsGoogle(name, type) {

    const url =
        'https://dns.google/resolve?name=' +
        encodeURIComponent(name) +
        '&type=' +
        encodeURIComponent(type);

    const response =
        await fetch(
            url,
            {
                headers:{
                    Accept:'application/dns-json'
                }
            }
        );

    if (!response.ok) {
        throw new Error(
            'DNS-over-HTTPS HTTP ' +
            response.status
        );
    }

    const payload =
        await response.json();

    if (
        payload.Status !== 0 ||
        !Array.isArray(payload.Answer)
    ) {
        throw new Error(
            'DNS-over-HTTPS returned no usable answer.'
        );
    }

    return payload.Answer;
}


async function resolveSrvWithFallback(name) {

    try {
        return await nativeResolveSrv(name);
    }
    catch (nativeError) {

        if (!isMongoAtlasName(name)) {
            throw nativeError;
        }

        console.warn(
            '[PMIS LOCAL DNS] Native SRV failed:',
            nativeError.code || nativeError.message
        );

        const answers =
            await dnsGoogle(
                name,
                'SRV'
            );

        const records =
            answers
                .filter(row =>
                    Number(row.type) === 33
                )
                .map(row => {

                    const pieces =
                        String(row.data || '')
                            .trim()
                            .split(/\s+/);

                    if (pieces.length < 4) {
                        return null;
                    }

                    return {
                        priority:
                            Number(pieces[0]),
                        weight:
                            Number(pieces[1]),
                        port:
                            Number(pieces[2]),
                        name:
                            pieces
                                .slice(3)
                                .join(' ')
                                .replace(/\.$/, '')
                    };
                })
                .filter(Boolean);

        if (!records.length) {
            throw nativeError;
        }

        console.warn(
            '[PMIS LOCAL DNS] Atlas SRV recovered through HTTPS.'
        );

        return records;
    }
}


async function resolveTxtWithFallback(name) {

    try {
        return await nativeResolveTxt(name);
    }
    catch (nativeError) {

        if (!isMongoAtlasName(name)) {
            throw nativeError;
        }

        console.warn(
            '[PMIS LOCAL DNS] Native TXT failed:',
            nativeError.code || nativeError.message
        );

        const answers =
            await dnsGoogle(
                name,
                'TXT'
            );

        const records =
            answers
                .filter(row =>
                    Number(row.type) === 16
                )
                .map(row => {

                    const raw =
                        String(row.data || '');

                    const parts = [];

                    const regex =
                        /"((?:\\.|[^"])*)"/g;

                    let match;

                    while (
                        (match = regex.exec(raw)) !== null
                    ) {
                        parts.push(
                            match[1]
                                .replace(/\\"/g, '"')
                                .replace(/\\\\/g, '\\')
                        );
                    }

                    if (parts.length) {
                        return parts;
                    }

                    return [
                        raw.replace(
                            /^"|"$/g,
                            ''
                        )
                    ];
                });

        console.warn(
            '[PMIS LOCAL DNS] Atlas TXT recovered through HTTPS.'
        );

        return records;
    }
}


/*
 * MongoDB Node Driver normally uses dns.promises.
 */
promises.resolveSrv =
    resolveSrvWithFallback;

promises.resolveTxt =
    resolveTxtWithFallback;


/*
 * Also cover code using callback-style Node DNS.
 */
dns.resolveSrv =
    function(name, callback) {

        resolveSrvWithFallback(name)
            .then(
                result =>
                    callback(null,result)
            )
            .catch(
                error =>
                    callback(error)
            );
    };


dns.resolveTxt =
    function(name, callback) {

        resolveTxtWithFallback(name)
            .then(
                result =>
                    callback(null,result)
            )
            .catch(
                error =>
                    callback(error)
            );
    };


console.log(
    '[PMIS LOCAL DNS] MongoDB DNS recovery active.'
);
