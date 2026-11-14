const psfFamily = new Set([
    'psf', 'minipsf', 'psf2', 'minipsf2', 'minips2', 'gsf', 'minigsf',
    'usf', 'miniusf', 'ssf', 'minissf', 'dsf', 'minidsf'
]);
const extraFormats = ['stm', 'psf2', 'minipsf2', 'minips2', 'oga', 'aac'];
const playerExtensions = [...new Set([...Object.values(DECODERS).flat(), ...extraFormats])].sort();
const trackerFormats = new Set(['mod', 'xm', 'it', 's3m', 'mtm', 'stm']);
const mediaFormats = new Set(['aac', 'oga', 'wav', 'mp3', 'ogg', 'flac', 'm4a']);
const banks = {kss: 'mbk', kssx: 'mbk', kscc: 'mbk'};
const capsuleRates = {st: 31400, iv: 44100, gbc: 32768, gba: 32768, jaguar: 48000,
    md: 44100, sv: 44100, vx: 187500, ws: 44100};
const boardTrackCounts = {enson: 256, f3: 512, bsmt: 256, astro: 256, ki: 13, model2: 256};

function routeFile(extension, buffer) {
    const bytes = new Uint8Array(buffer);
    if (extension === 'stm') {
        if (bytes.length >= 4 && bytes[0] === 83 && bytes[1] === 84 && bytes[2] === 77 && bytes[3] === 26)
            return {id: 'st', format: 'stm', worker: 'st-worker.js'};
        return {id: 'broad', format: 'stm', worker: 'codec-worker.js'};
    }
    if (['psf2', 'minipsf2', 'minips2'].includes(extension))
        return {id: 'psf2', format: extension, worker: 'psf2-worker.js'};
    return decoderFor({format: extension}, buffer);
}

function trackSelection(extension, buffer, route) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const sid = ['sid', 'psid', 'rsid'].includes(extension);
    if (sid && bytes.length >= 18) {
        const count = view.getUint16(14, false);
        const first = view.getUint16(16, false);
        return {first: 1, count: Math.max(1, count), selected: first >= 1 && first <= count ? first : 1};
    }
    if (extension === 'nsf' && bytes.length >= 8) {
        const count = Math.max(1, bytes[6]);
        const first = bytes[7] - 1;
        return {first: 0, count, selected: first >= 0 && first < count ? first : 0};
    }
    if (extension === 'nsfe') return nsfeSelection(bytes, view);
    if (extension === 'gbs' && bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x42 && bytes[2] === 0x53) {
        const count = Math.max(1, bytes[4]);
        return {first: 0, count, selected: Math.max(0, Math.min(count - 1, bytes[5] - 1))};
    }
    if (extension === 'hes' && bytes.length >= 6) return {first: 0, count: 256, selected: bytes[5]};
    if (extension === 'ay' && bytes.length >= 18) {
        const count = bytes[16] + 1;
        return {first: 0, count, selected: Math.min(count - 1, bytes[17])};
    }
    if (extension === 'wsr' && bytes.length >= 32)
        return {first: 0, count: 256, selected: bytes[bytes.length - 27]};
    if (Object.hasOwn(capsuleRates, route.id) && bytes.length >= 128) {
        const count = view.getUint32(24, true);
        if (count > 0 && count <= 64 && view.getUint32(36, true) === 128 + count * 64) {
            const rate = capsuleRates[route.id];
            const durations = Array.from({length: count}, (_, index) => {
                const offset = 128 + index * 64 + 28;
                return offset + 4 <= bytes.length ? view.getUint32(offset, true) / rate : null;
            });
            return {first: 0, count, selected: 0, durations};
        }
    }
    if (['a5', 'nf', 'dcs'].includes(route.id) && bytes.length >= 16) {
        const length = view.getUint32(4, true);
        if (length && length <= 65536 && length + 16 <= bytes.length) {
            const data = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + length)));
            if (Array.isArray(data.tracks) && data.tracks.length && data.tracks.length <= 64) {
                const rate = route.id === 'dcs' ? 31250 : data.source_rate;
                return {first: 0, count: data.tracks.length, selected: 0,
                    names: data.tracks.map(track => typeof track.title === 'string' ? track.title : ''),
                    durations: data.tracks.map(track => rate > 0 ? track.audio_frames / rate : null)};
            }
        }
    }
    if (Object.hasOwn(boardTrackCounts, route.id))
        return {first: 0, count: null, selected: 0, max: boardTrackCounts[route.id]};
    if (trackerFormats.has(extension) && route.id === 'broad') return {first: 0, count: 1, selected: 0};
    if (psfFamily.has(extension) || ['libvgm', 'atari'].includes(route.id) ||
        ['gym', 'spc'].includes(extension) || !['gme', 'gme-plus', 'broad'].includes(route.id))
        return {first: 0, count: 1, selected: 0};
    return {first: 0, count: null, selected: 0};
}

function nsfeSelection(bytes, view) {
    let count = 1, selected = 0;
    let names, durations;
    const decoder = new TextDecoder();
    for (let offset = 4; offset + 8 <= bytes.length;) {
        const length = view.getUint32(offset, true);
        const tag = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        const start = offset + 8;
        offset = start + length;
        if (offset > bytes.length || tag === 'NEND') break;
        if (tag === 'INFO' && length >= 8) {
            count = length >= 9 ? Math.max(1, bytes[start + 8]) : 1;
            selected = length >= 10 ? Math.min(count - 1, bytes[start + 9]) : 0;
        }
        if (tag === 'tlbl') names = decoder.decode(bytes.subarray(start, Math.min(start + 65536, offset))).split('\0');
        if (tag === 'time') durations = Array.from({length: Math.min(256, Math.floor(length / 4))}, (_, index) =>
            view.getInt32(start + index * 4, true) / 1000);
    }
    // The bundled GME worker clears the optional NSFE playlist.
    return {first: 0, count, selected, names, durations};
}

function psfTags(buffer) {
    if (buffer.byteLength < 16) return new Map();
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 80 || bytes[1] !== 83 || bytes[2] !== 70) return new Map();
    const view = new DataView(buffer);
    const start = 16 + view.getUint32(4, true) + view.getUint32(8, true);
    if (start > bytes.length) throw Error('Повреждённый заголовок PSF');
    const tag = new TextDecoder().decode(bytes.subarray(start));
    if (!tag.startsWith('[TAG]')) return new Map();
    return new Map(tag.slice(5).split(/[\r\n\0]+/).filter(line => line.includes('=')).map(line => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
    }));
}

function referencedPath(parent, name) {
    if (/^[/\\]|[:|\u0000-\u001f]/.test(name)) throw new PlayerError('invalidLibrary', name);
    const path = parent.split('/').slice(0, -1);
    for (const component of name.split(/[/\\]/)) {
        if (!component || component === '.') continue;
        if (component === '..') {
            if (!path.length) throw new PlayerError('invalidLibrary', name);
            path.pop();
        } else path.push(component);
    }
    if (!path.length) throw new PlayerError('invalidLibrary', name);
    return path.join('/');
}

async function loadDependencies(vault, file, extension, bytes) {
    const dependencies = new Map();
    if (psfFamily.has(extension)) {
        const root = file.path;
        const visiting = new Set([root]);
        async function collect(path, input) {
            for (const [key, value] of psfTags(input)) {
                if (!/^_lib(?:[1-9]\d*)?$/.test(key) || !value) continue;
                const dependencyPath = referencedPath(path, value);
                if (visiting.has(dependencyPath)) throw new PlayerError('invalidLibrary', dependencyPath);
                if (dependencies.has(dependencyPath)) continue;
                let dependency = vault.getAbstractFileByPath(dependencyPath);
                if (!dependency) {
                    dependency = vault.getFiles().find(candidate => candidate.path.toLowerCase() === dependencyPath.toLowerCase());
                }
                const payload = dependency instanceof TFile ? await vault.readBinary(dependency) :
                    await vault.adapter.readBinary(dependencyPath).catch(() => null);
                if (!payload) throw new PlayerError('missingLibrary', value);
                visiting.add(dependencyPath);
                dependencies.set(dependencyPath, payload);
                await collect(dependencyPath, payload);
                visiting.delete(dependencyPath);
            }
        }
        await collect(root, bytes);
    } else if (Object.hasOwn(banks, extension)) {
        const path = file.path.replace(/\.[^.]+$/, '.' + banks[extension]);
        if (await vault.adapter.exists(path)) dependencies.set(path, await vault.adapter.readBinary(path));
    }
    return [...dependencies].map(([path, bytes]) => ({path, bytes}));
}

function parsePsfDuration(tags) {
    const seconds = key => {
        const value = tags.get(key);
        if (!value || !/^\d+(?::\d+){0,2}(?:[.,]\d+)?$/.test(value)) return 0;
        return value.replace(',', '.').split(':').reduce((total, part) => total * 60 + Number(part), 0);
    };
    const length = seconds('length');
    return length > 0 ? length + seconds('fade') : null;
}

async function unpackCapsule(viewWindow, buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 31 || bytes[1] !== 139) return buffer;
    const stream = new viewWindow.Blob([buffer]).stream().pipeThrough(new viewWindow.DecompressionStream('gzip'));
    const reader = stream.getReader();
    const parts = [];
    let size = 0;
    try {
        while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 40_000_000) throw Error('Expanded music capsule is too large');
            parts.push(value);
        }
        return await new viewWindow.Blob(parts).arrayBuffer();
    } finally {
        await reader.cancel();
    }
}

function trackDuration(extension, buffer, route, index) {
    if (psfFamily.has(extension)) return parsePsfDuration(psfTags(buffer));
    const view = new DataView(buffer);
    if (route.id === 'libvgm' && extension === 'vgm' && buffer.byteLength >= 0x1c &&
        view.getUint32(0, false) === 0x56676d20) {
        const samples = view.getUint32(0x18, true);
        return samples > 0 ? samples / 44100 : null;
    }
    if (route.id === 'st' && extension === 'stm' && buffer.byteLength >= 128) {
        const offset = 128 + index * 64;
        if (buffer.byteLength < offset + 32) return null;
        const samples = view.getUint32(offset + 28, true);
        return samples > 0 ? samples / 31400 : null;
    }
    if (extension === 'spc' && buffer.byteLength >= 0xad && view.getUint8(0x23) === 0x1a) {
        const text = new TextDecoder().decode(new Uint8Array(buffer, 0xa9, 3)).match(/^\d{1,3}(?=\0|$)/);
        const seconds = text ? Number(text[0]) : view.getUint16(0xa9, true);
        return seconds > 0 && seconds < 0x1fff ? seconds : null;
    }
    return null;
}

function trackTitle(extension, buffer) {
    if (psfFamily.has(extension)) return psfTags(buffer).get('title');
    const fields = {spc: [0x2e, 32], mod: [0, 20], xm: [17, 20], s3m: [0, 28], it: [4, 26]};
    const field = fields[extension];
    if (field && buffer.byteLength >= field[0] + field[1]) {
        const title = new TextDecoder().decode(new Uint8Array(buffer, ...field)).split('\0', 1)[0].trim();
        if (!title.includes('\ufffd')) return title;
    }
    return '';
}
