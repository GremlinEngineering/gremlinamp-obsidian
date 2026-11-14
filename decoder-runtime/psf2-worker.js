// Audio Overload emulates the PS2 IOP and SPU2 at 44.1 kHz.
const sourceRate = 44100;
let runtime, ready, sampleRate, sourceIndex = 735;
let left, right, nextLeft, nextRight, fraction = 0;

function installFile(name, bytes) {
    const path = '/music/' + name;
    runtime.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    runtime.FS.writeFile(path, new Uint8Array(bytes));
}

async function load(message) {
    const wasm = await fetch(new URL('vendor/psf2/gremlin-psf2.wasm', self.location.href));
    const module = await WebAssembly.compile(await wasm.arrayBuffer());
    importScripts('vendor/psf2/gremlin-psf2.js');
    runtime = await GremlinPsf2({
        instantiateWasm(imports, receive) {
            const instance = new WebAssembly.Instance(module, imports);
            receive(instance);
            return instance.exports;
        },
        print() {},
        printErr() {}
    });
    for (const file of message.dependencies) installFile(file.path, file.bytes);
    const directory = message.filename.slice(0, message.filename.lastIndexOf('/') + 1);
    runtime.FS.mkdirTree('/music/' + directory);
    runtime.FS.chdir('/music/' + directory);
    const input = runtime._malloc(message.bytes.byteLength);
    if (!input) throw Error('Недостаточно памяти для PSF2');
    runtime.HEAPU8.set(new Uint8Array(message.bytes), input);
    if (!runtime._gremlin_psf2_open(input, message.bytes.byteLength))
        throw Error('Декодер не смог открыть PSF2');
    sampleRate = message.sampleRate;
    readNext();
    left = nextLeft;
    right = nextRight;
    readNext();
    postMessage({type: 'ready', decoder: 'psf2'});
}

let audio;
function readNext() {
    if (sourceIndex === 735) {
        const pointer = runtime._gremlin_psf2_render();
        audio = new Int16Array(runtime.HEAP16.buffer, pointer, 735 * 2);
        sourceIndex = 0;
    }
    nextLeft = audio[sourceIndex * 2] / 32768;
    nextRight = audio[sourceIndex * 2 + 1] / 32768;
    ++sourceIndex;
}

function render(frames) {
    const pcm = new Float32Array(frames * 2);
    for (let i = 0; i < frames; ++i) {
        const mix = fraction / sampleRate;
        pcm[i * 2] = left + (nextLeft - left) * mix;
        pcm[i * 2 + 1] = right + (nextRight - right) * mix;
        fraction += sourceRate;
        while (fraction >= sampleRate) {
            fraction -= sampleRate;
            left = nextLeft;
            right = nextRight;
            readNext();
        }
    }
    postMessage({type: 'pcm', pcm: pcm.buffer}, [pcm.buffer]);
}

onmessage = ({data}) => {
    const report = error => postMessage({type: 'error', message: String(error.message || error)});
    if (data.type === 'load') ready = load(data).then(() => true, error => { report(error); return false; });
    if (data.type === 'render') ready?.then(ok => { if (ok) render(data.frames); }).catch(report);
};
