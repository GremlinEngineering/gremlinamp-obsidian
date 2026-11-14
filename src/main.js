const {FileView, Plugin, TFile} = require('obsidian');
const viewType = 'gremlinamp-music';

class MusicView extends FileView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return viewType; }
    getDisplayText() { return this.file?.name ?? 'GremlinAmp'; }
    getIcon() { return 'music'; }

    async onLoadFile(file) {
        this.stop();
        this.currentFile = file;
        this.selectionFile = null;
        this.selectedTrack = '1';
        const content = this.contentEl;
        content.empty();
        const panel = content.createDiv({cls: 'gremlinamp-player'});
        panel.createEl('h2', {text: file.name});
        const controls = panel.createDiv({cls: 'gremlinamp-controls'});
        this.playButton = controls.createEl('button', {text: 'Играть', cls: 'mod-cta'});
        this.stopButton = controls.createEl('button', {text: 'Стоп'});
        const trackLabel = controls.createEl('label', {text: 'Дорожка'});
        this.trackInput = trackLabel.createEl('input', {type: 'number', value: '1'});
        this.trackInput.min = '1';
        this.trackInput.max = '65535';
        trackLabel.hidden = mediaFormats.has(file.extension.toLowerCase());
        const volumeLabel = controls.createEl('label', {text: 'Громкость'});
        const volume = volumeLabel.createEl('input', {type: 'range', value: String(this.plugin.volume)});
        volume.min = '0';
        volume.max = '1';
        volume.step = '0.01';
        this.status = panel.createEl('p', {attr: {role: 'status'}});
        this.elapsed = panel.createEl('p', {cls: 'gremlinamp-time'});
        this.playButton.addEventListener('click', () => void this.play());
        this.stopButton.addEventListener('click', () => this.stop());
        this.trackInput.addEventListener('change', () => {
            if (!this.trackInput.checkValidity() || this.trackInput.value === '') {
                this.trackInput.value = this.selectedTrack;
                return;
            }
            this.selectedTrack = this.trackInput.value;
            this.selectionFile = file;
            this.stop();
        });
        volume.addEventListener('input', () => {
            this.plugin.volume = Number(volume.value);
            this.playback?.volume(this.plugin.volume);
            if (this.audio) this.audio.volume = this.plugin.volume;
        });
        this.update();
    }

    async onUnloadFile() { this.stop(); this.currentFile = null; }
    async onClose() { this.stop(); this.currentFile = null; }

    async play() {
        const file = this.currentFile;
        if (!file || this.playback?.state === 'loading') return;
        if (this.audio && this.mediaState !== 'error') {
            try {
                if (this.audio.paused) await this.audio.play();
                else this.audio.pause();
            } catch (error) { this.report(error); }
            return;
        }
        if (['paused', 'playing'].includes(this.playback?.state)) {
            await this.playback.toggle();
            return;
        }
        const viewWindow = this.contentEl.ownerDocument.defaultView;
        this.plugin.claim(this);
        this.stop(false);
        const request = {};
        this.request = request;
        this.error = '';
        const extension = file.extension.toLowerCase();
        if (mediaFormats.has(extension)) {
            this.playMedia(file);
            return;
        }
        try {
            const playback = new DecoderPlayback(viewWindow, () => this.update());
            this.playback = playback;
            playback.volume(this.plugin.volume);
            this.update();
            let bytes = await this.plugin.app.vault.readBinary(file);
            if (this.request !== request) return;
            if (!bytes.byteLength) throw Error('Пустой музыкальный файл');
            if (extension === 'stm') bytes = await unpackStm(viewWindow, bytes);
            if (this.request !== request) return;
            const route = routeFile(extension, bytes);
            const selection = trackSelection(extension, bytes, route);
            this.setTrackCount(selection.count);
            this.trackInput.parentElement.hidden = selection.count === 1;
            if (this.selectionFile !== file || !this.trackInput.checkValidity()) {
                this.trackInput.value = String(selection.selected - selection.first + 1);
                this.selectedTrack = this.trackInput.value;
                this.selectionFile = file;
            }
            const subsong = Number(this.trackInput.value) - 1 + selection.first;
            const dependencies = await loadDependencies(this.plugin.app.vault, file, extension, bytes);
            if (this.request !== request) return;
            const duration = trackDuration(extension, bytes, route, subsong);
            const filename = file.path;
            const gsfRenderMs = (duration ?? 120) * 1000;
            await playback.start(route, {decoder: route.id, format: route.format,
                filename, dependencies, bytes, subsong, renderMs: gsfRenderMs}, route.id === 'gsf' ? gsfRenderMs / 1000 : duration);
        } catch (error) {
            if (this.request === request) {
                if (this.playback) this.playback.fail(error.message);
                else this.report(error);
            }
        }
    }

    playMedia(file) {
        const audio = this.contentEl.ownerDocument.createElement('audio');
        this.audio = audio;
        this.mediaState = 'loading';
        audio.volume = this.plugin.volume;
        for (const event of ['play', 'pause', 'ended', 'timeupdate', 'error']) {
            audio.addEventListener(event, () => {
                if (audio !== this.audio) return;
                if (event === 'error') this.report(Error('Система не смогла открыть ' + file.name));
                else if (event !== 'timeupdate') this.mediaState = audio.ended ? 'ended' : audio.paused ? 'paused' : 'playing';
                this.update();
            });
        }
        audio.src = this.plugin.app.vault.getResourcePath(file);
        this.update();
        void audio.play().catch(error => { if (this.audio === audio) this.report(error); });
    }

    report(error) {
        this.error = String(error.message || error);
        this.mediaState = 'error';
        this.update();
    }

    setTrackCount(count) {
        if (!count) return;
        this.trackInput.max = String(count);
        this.trackInput.parentElement.hidden = count === 1;
    }

    stop(update = true) {
        this.request = null;
        this.error = '';
        const audio = this.audio;
        this.audio = null;
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        }
        this.mediaState = null;
        const playback = this.playback;
        this.playback = null;
        playback?.stop();
        if (update) this.update();
    }

    update() {
        if (!this.status) return;
        const playback = this.playback;
        this.setTrackCount(playback?.metadata?.tracks);
        const state = playback?.state ?? this.mediaState ?? 'stopped';
        this.playButton.textContent = state === 'playing' ? 'Пауза' : state === 'paused' ? 'Продолжить' : 'Играть';
        this.playButton.disabled = state === 'loading';
        this.stopButton.disabled = state === 'stopped';
        this.trackInput.disabled = state === 'loading';
        const status = {loading: 'Подготовка трека…', playing: 'Играет', paused: 'Пауза', ended: 'Трек завершён', stopped: ''};
        this.status.textContent = playback?.error ?? (this.error || status[state] || '');
        const seconds = playback?.seconds ?? this.audio?.currentTime ?? 0;
        const duration = playback?.duration ?? this.audio?.duration;
        this.elapsed.textContent = timeLabel(seconds) + (duration > 0 && Number.isFinite(duration) ? ' / ' + timeLabel(duration) : '');
    }
}

function timeLabel(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

module.exports = class GremlinAmp extends Plugin {
    volume = 0.7;

    onload() {
        this.registerView(viewType, leaf => new MusicView(leaf, this));
        for (const extension of playerExtensions) {
            try { this.registerExtensions([extension], viewType); }
            catch (error) { console.warn('GremlinAmp could not register .' + extension, error); }
        }
    }

    claim(view) {
        if (this.active !== view) {
            this.active?.stop();
            this.active = view;
        }
    }

    onunload() {
        for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
            leaf.view.stop();
            leaf.detach();
        }
        this.active = null;
    }
};
