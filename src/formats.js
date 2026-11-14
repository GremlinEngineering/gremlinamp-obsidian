const psfFamily = new Set([
    'psf', 'minipsf', 'psf2', 'minipsf2', 'minips2', 'gsf', 'minigsf',
    'usf', 'miniusf', 'ssf', 'minissf', 'dsf', 'minidsf'
]);
const extraFormats = ['stm', 'psf2', 'minipsf2', 'minips2', 'oga', 'aac'];
const playerExtensions = [...new Set([...Object.values(DECODERS).flat(), ...extraFormats])].sort();
const trackerFormats = new Set(['mod', 'xm', 'it', 's3m', 'mtm', 'stm']);
const mediaFormats = new Set(['aac', 'oga']);
const banks = {kss: 'mbk', kssx: 'mbk', kscc: 'mbk'};

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
    if (extension === 'wsr' && bytes.length >= 32)
        return {first: 0, count: 256, selected: bytes[bytes.length - 27]};
    if (trackerFormats.has(extension) && route.id === 'broad') return {first: 0, count: 1, selected: 0};
    if (route.id === 'psf2' || route.id === 'gsf' || psfFamily.has(extension))
        return {first: 0, count: 1, selected: 0};
    return {first: 0, count: null, selected: 0};
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
    if (/^[/\\]|[:|\u0000-\u001f]/.test(name)) throw Error('Недопустимый путь библиотеки: ' + name);
    const path = parent.split('/').slice(0, -1);
    for (const component of name.split(/[/\\]/)) {
        if (!component || component === '.') continue;
        if (component === '..') {
            if (!path.length) throw Error('Библиотека находится за пределами хранилища: ' + name);
            path.pop();
        } else path.push(component);
    }
    if (!path.length) throw Error('Недопустимый путь библиотеки: ' + name);
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
                if (visiting.has(dependencyPath)) throw Error('Циклическая зависимость PSF: ' + dependencyPath);
                if (dependencies.has(dependencyPath)) continue;
                let dependency = vault.getAbstractFileByPath(dependencyPath);
                if (!dependency) {
                    dependency = vault.getFiles().find(candidate => candidate.path.toLowerCase() === dependencyPath.toLowerCase());
                }
                const payload = dependency instanceof TFile ? await vault.readBinary(dependency) :
                    await vault.adapter.readBinary(dependencyPath).catch(() => null);
                if (!payload) throw Error('Отсутствует библиотека ' + value + ' для ' + path);
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

async function unpackStm(viewWindow, buffer) {
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
            if (size > 40_000_000) throw Error('Распакованный STM слишком велик');
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
    return null;
}
