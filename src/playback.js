const chunkFrames = 4096;
const queueDepth = 4;

class DecoderPlayback {
    constructor(viewWindow, onChange) {
        this.window = viewWindow;
        this.onChange = onChange;
        this.state = 'loading';
        this.sources = new Set();
        this.clock = 0;
        this.context = new viewWindow.AudioContext();
        this.gain = this.context.createGain();
        this.gain.connect(this.context.destination);
        this.activation = this.context.resume();
        // The first decoder response may take some time.
        this.activation.catch(() => {});
    }

    async start(route, message, duration) {
        if (this.state === 'stopped') return;
        try {
            await this.activation;
            if (this.state === 'stopped') return;
            this.duration = duration;
            this.decoder = startDecoder(this.window, route.worker, decoderAssetsByWorker[route.worker]);
            this.decoder.worker.onerror = event => this.fail(event.message || 'Не удалось запустить декодер');
            this.decoder.worker.onmessage = ({data}) => {
                try {
                    if (data.type === 'error') this.fail(data.message);
                    if (data.type === 'ready') {
                        this.metadata = data;
                        if (Number.isFinite(data.duration) && data.duration > 0) this.duration ??= data.duration;
                        for (let index = 0; index < queueDepth; ++index) this.request();
                    }
                    if (data.type === 'pcm') this.enqueue(data);
                } catch (error) { this.fail(error.message); }
            };
            this.timeout = this.window.setTimeout(() => this.fail('Декодер не ответил вовремя'), 120000);
            const buffers = [message.bytes, ...message.dependencies.map(file => file.bytes)];
            this.decoder.worker.postMessage({...message, type: 'load', sampleRate: this.context.sampleRate}, buffers);
        } catch (error) { this.fail(error.message); }
    }

    request() {
        if (this.decoder && !this.finished) this.decoder.worker.postMessage({type: 'render', frames: chunkFrames});
    }

    enqueue(message) {
        if (this.finished || this.state === 'stopped' || this.state === 'error') return;
        const samples = new Float32Array(message.pcm);
        if (samples.length % 2 || samples.length > chunkFrames * 2) throw Error('Некорректный звуковой блок');
        const context = this.context;
        const remaining = this.duration == null ? Infinity :
            Math.max(0, Math.ceil(this.duration * context.sampleRate - this.clock));
        const length = Math.min(samples.length / 2, remaining);
        this.finished = message.ended === true || remaining <= length;
        if (length > 0) {
            const buffer = context.createBuffer(2, length, context.sampleRate);
            const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
            for (let i = 0; i < length; ++i) {
                left[i] = samples[i * 2];
                right[i] = samples[i * 2 + 1];
            }
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(this.gain);
            this.nextTime = Math.max(this.nextTime ?? context.currentTime + 0.06, context.currentTime + 0.01);
            this.spans ??= [];
            this.spans.push({start: this.nextTime, offset: this.clock / context.sampleRate, length: buffer.duration});
            source.start(this.nextTime);
            this.clock += length;
            this.nextTime += buffer.duration;
            this.sources.add(source);
            source.onended = () => {
                this.sources.delete(source);
                source.disconnect();
                if (this.finished) {
                    if (!this.sources.size) this.end();
                } else this.request();
            };
        }
        if (this.state === 'loading' && length) {
            this.window.clearTimeout(this.timeout);
            this.state = 'playing';
            this.timer = this.window.setInterval(() => this.onChange(), 200);
            this.onChange();
        }
        if (this.finished && !this.sources.size) this.end();
    }

    get seconds() {
        if (this.state === 'ended') return this.clock / this.context.sampleRate;
        if (!this.spans?.length) return 0;
        const now = this.context.currentTime;
        while (this.spans.length > 1 && this.spans[1].start <= now) this.spans.shift();
        const span = this.spans[0];
        return span.offset + Math.max(0, Math.min(span.length, now - span.start));
    }

    async toggle() {
        if (this.transition || !['playing', 'paused'].includes(this.state)) return;
        const pause = this.state === 'playing';
        this.transition = true;
        try {
            if (pause) await this.context.suspend();
            else await this.context.resume();
            if (['playing', 'paused'].includes(this.state)) this.state = pause ? 'paused' : 'playing';
        } catch (error) { this.fail(error.message); }
        finally { this.transition = false; this.onChange(); }
    }

    volume(value) { this.gain.gain.value = value; }

    end() {
        this.state = 'ended';
        this.disposeAudio();
        this.onChange();
    }

    fail(message) {
        if (this.state === 'stopped' || this.state === 'ended') return;
        this.error = message;
        this.state = 'error';
        this.disposeAudio();
        this.onChange();
    }

    stop() {
        this.state = 'stopped';
        this.disposeAudio();
    }

    disposeAudio() {
        this.window.clearTimeout(this.timeout);
        this.window.clearInterval(this.timer);
        this.decoder?.dispose();
        this.decoder = null;
        for (const source of this.sources) {
            source.onended = null;
            source.stop();
            source.disconnect();
        }
        this.sources.clear();
        if (this.context.state !== 'closed') void this.context.close().catch(() => {});
    }
}
