function startDecoder(viewWindow, workerName, assetNames) {
    const urls = [];
    const makeUrl = (bytes, type) => {
        const url = viewWindow.URL.createObjectURL(new viewWindow.Blob([bytes], {type}));
        urls.push(url);
        return url;
    };
    const disposeUrls = () => {
        for (const url of urls) viewWindow.URL.revokeObjectURL(url);
        urls.length = 0;
    };
    try {
        const assets = {};
        for (const name of assetNames) {
            const mime = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
            assets[name] = makeUrl(decodeAsset(viewWindow, name), mime);
        }
        const prelude = `
            const decoderBase = 'https://gremlinamp.invalid/';
            const decoderAssets = ${JSON.stringify(assets)};
            const originalFetch = self.fetch.bind(self);
            const originalImportScripts = self.importScripts.bind(self);
            function mappedAsset(path) {
                const url = new URL(path, decoderBase);
                const name = url.pathname.slice(1);
                if (url.origin !== 'https://gremlinamp.invalid' || !Object.hasOwn(decoderAssets, name))
                    throw Error('Missing bundled decoder asset: ' + name);
                return decoderAssets[name];
            }
            self.fetch = (path, options) => originalFetch(mappedAsset(path), options);
            self.importScripts = (...paths) => originalImportScripts(...paths.map(mappedAsset));
        `;
        const worker = new viewWindow.Worker(makeUrl(prelude + new viewWindow.TextDecoder().decode(decodeAsset(viewWindow, workerName)), 'text/javascript'));
        return {
            worker,
            dispose() {
                worker.terminate();
                disposeUrls();
            }
        };
    } catch (error) {
        disposeUrls();
        throw error;
    }
}

function decodeAsset(viewWindow, name) {
    if (!Object.hasOwn(bundledAssets, name)) throw Error('Missing bundled decoder asset: ' + name);
    const binary = viewWindow.atob(bundledAssets[name]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; ++index) bytes[index] = binary.charCodeAt(index);
    return bytes;
}
