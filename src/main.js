const {FileView, Notice, Plugin, PluginSettingTab, Setting, TFile, getLanguage, setIcon} = require('obsidian');
const viewType = 'gremlinamp-music';
const defaultSelection = {first: 0, count: 1, selected: 0};
const byFilename = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

class MusicView extends FileView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.mode = 'file';
    }

    getViewType() { return viewType; }
    getDisplayText() { return this.currentFile?.name ?? this.file?.name ?? 'GremlinAmp'; }
    getIcon() { return 'music'; }
    canAcceptExtension(extension) { return playerExtensions.includes(extension.toLowerCase()); }

    onload() {
        super.onload();
        const vault = this.plugin.app.vault;
        this.registerEvent(vault.on('create', file => this.refreshFolder(file)));
        this.registerEvent(vault.on('delete', file => this.refreshFolder(file)));
        this.registerEvent(vault.on('rename', () => {
            if (this.currentFile) {
                this.update();
                this.renderTracklist();
            }
        }));
        this.registerEvent(vault.on('modify', file => {
            if (file === this.currentFile) this.preparation = null;
        }));
    }

    async onLoadFile(file) {
        this.stop(false);
        this.currentFile = file;
        this.preparation = null;
        this.prepared = null;
        this.selection = defaultSelection;
        this.subsong = 0;
        this.durations = new Map();
        this.renderPlayer();
        if (this.pendingFile === file) {
            this.pendingFile = null;
            void this.start();
        } else if (!mediaFormats.has(file.extension.toLowerCase())) {
            void this.prepare(file).catch(() => {});
        }
    }

    async onUnloadFile() { this.resetFile(); }
    async onClose() { this.resetFile(); }

    resetFile() {
        this.currentFile = null;
        this.preparation = null;
        this.prepared = null;
        this.stop(false);
    }

    refreshFolder(file) {
        if (this.mode === 'folder' && this.currentFile && file.parent === this.currentFile.parent)
            this.renderTracklist();
    }

    renderPlayer() {
        this.contentEl.empty();
        const root = this.contentEl.createDiv({cls: 'gremlinamp-player'});
        const player = root.createEl('section', {cls: 'gremlinamp-panel'});
        const summary = player.createDiv({cls: 'gremlinamp-summary'});
        const artwork = summary.createDiv({cls: 'gremlinamp-art', attr: {'aria-hidden': 'true'}});
        setIcon(artwork, 'music-2');
        const nowPlaying = summary.createDiv({cls: 'gremlinamp-now-playing'});
        this.status = nowPlaying.createDiv({cls: 'gremlinamp-status', attr: {role: 'status'}});
        this.titleEl = nowPlaying.createEl('h2');
        this.fileEl = nowPlaying.createDiv({cls: 'gremlinamp-file'});
        const timeline = player.createDiv({cls: 'gremlinamp-timeline'});
        this.elapsed = timeline.createSpan();
        this.position = timeline.createEl('input', {type: 'range', attr: {min: '0', max: '1', step: '0.01'}});
        this.total = timeline.createSpan();
        this.position.addEventListener('input', () => this.showTime(Number(this.position.value)));
        this.position.addEventListener('change', () => void this.seek(Number(this.position.value)));

        const transport = player.createDiv({cls: 'gremlinamp-transport'});
        const actions = transport.createDiv({cls: 'gremlinamp-actions'});
        this.previousButton = this.button(actions, 'skip-back', () => void this.step(-1));
        this.backButton = this.button(actions, null, () => void this.seek(this.seconds - 10), '−10');
        this.playButton = this.button(actions, null, () => void this.play(), '', 'mod-cta gremlinamp-play');
        this.forwardButton = this.button(actions, null, () => void this.seek(this.seconds + 10), '+10');
        this.nextButton = this.button(actions, 'skip-forward', () => void this.step(1));
        this.stopButton = this.button(actions, 'square', () => this.stop());
        const volumeLabel = transport.createEl('label', {cls: 'gremlinamp-volume'});
        setIcon(volumeLabel.createSpan({attr: {'aria-hidden': 'true'}}), 'volume-2');
        this.volume = volumeLabel.createEl('input', {type: 'range',
            attr: {min: '0', max: '1', step: '0.01', value: String(this.plugin.volume)}});
        this.volume.addEventListener('input', () => {
            this.plugin.volume = Number(this.volume.value);
            this.playback?.volume(this.plugin.volume);
            if (this.audio) this.audio.volume = this.plugin.volume;
        });

        const tracks = root.createEl('section', {cls: 'gremlinamp-tracks'});
        const listHeading = tracks.createDiv({cls: 'gremlinamp-list-heading'});
        this.listTitle = listHeading.createEl('h3');
        this.scopes = listHeading.createDiv({cls: 'gremlinamp-scopes', attr: {role: 'group'}});
        this.fileButton = this.button(this.scopes, null, () => this.setMode('file'));
        this.folderButton = this.button(this.scopes, null, () => this.setMode('folder'));
        this.unknownTrack = tracks.createEl('label', {cls: 'gremlinamp-track-number'});
        this.trackLabel = this.unknownTrack.createSpan();
        this.trackInput = this.unknownTrack.createEl('input', {type: 'number', attr: {min: '1', max: '65535', step: '1'}});
        this.trackInput.addEventListener('change', () => {
            if (this.trackInput.value && this.trackInput.checkValidity()) {
                void this.selectSubsong(Number(this.trackInput.value) - 1 + this.selection.first);
            } else {
                this.trackInput.value = String(this.subsong - this.selection.first + 1);
            }
        });
        this.list = tracks.createEl('ol', {cls: 'gremlinamp-list'});
        this.localize();
    }

    button(parent, icon, action, label = '', cls = '') {
        const button = parent.createEl('button', {type: 'button', text: label, cls});
        if (icon) setIcon(button, icon);
        button.addEventListener('click', action);
        return button;
    }

    localize() {
        if (!this.currentFile) return;
        const copy = this.plugin.copy;
        for (const [element, key] of [
            [this.previousButton, 'previous'], [this.backButton, 'back'], [this.forwardButton, 'forward'],
            [this.nextButton, 'next'], [this.stopButton, 'stop'], [this.position, 'position'],
            [this.volume, 'volume'], [this.scopes, 'source']
        ]) {
            element.setAttribute('aria-label', copy[key]);
            if (element.tagName === 'BUTTON') element.title = copy[key];
        }
        this.listTitle.textContent = copy.tracklist;
        this.fileButton.textContent = copy.inFile;
        this.folderButton.textContent = copy.inFolder;
        this.trackLabel.textContent = copy.chooseTrack;
        this.renderTracklist();
        this.update();
    }

    setMode(mode) {
        if (this.mode === mode) return;
        this.mode = mode;
        this.renderTracklist();
        this.update();
    }

    renderTracklist() {
        if (!this.currentFile || !this.list) return;
        this.fileButton.setAttribute('aria-pressed', String(this.mode === 'file'));
        this.folderButton.setAttribute('aria-pressed', String(this.mode === 'folder'));
        const extension = this.currentFile.extension.toUpperCase();
        const files = this.currentFile.parent?.children ?? [this.currentFile];
        this.entries = this.mode === 'folder'
            ? files.filter(file => file instanceof TFile && this.canAcceptExtension(file.extension))
                .sort((a, b) => byFilename.compare(a.name, b.name))
                .map(file => ({file, title: file.basename, extension: file.extension.toUpperCase()}))
            : Array.from({length: this.selection.count ?? 0}, (_, index) => {
                const subsong = this.selection.first + index;
                return {subsong, extension, title: this.subsongTitle(subsong),
                    duration: this.knownDuration(subsong)};
            });
        this.unknownTrack.hidden = this.mode !== 'file' || this.selection.count !== null;
        this.trackInput.value = String(this.subsong - this.selection.first + 1);
        this.trackInput.max = String(this.selection.max ?? 65535);
        this.list.empty();
        this.rows = this.entries.map((entry, index) => {
            const button = this.button(this.list.createEl('li'), null, () => void this.selectEntry(entry));
            button.createSpan({text: String(index + 1).padStart(2, '0'), cls: 'gremlinamp-row-index'});
            button.createSpan({text: entry.title, cls: 'gremlinamp-row-title'});
            button.createSpan({text: entry.extension, cls: 'gremlinamp-row-format'});
            button.createSpan({text: entry.duration ? timeLabel(entry.duration) : '–:––', cls: 'gremlinamp-row-time'});
            return button;
        });
        this.updateSelection();
    }

    get entryIndex() {
        return this.entries?.findIndex(entry => this.mode === 'folder'
            ? entry.file === this.currentFile : entry.subsong === this.subsong) ?? -1;
    }

    updateSelection() {
        const index = this.entryIndex;
        this.previousButton.disabled = index < 1;
        this.nextButton.disabled = index < 0 || index >= this.entries.length - 1;
        this.rows.forEach((row, rowIndex) => {
            if (rowIndex === index) row.setAttribute('aria-current', 'true');
            else row.removeAttribute('aria-current');
        });
    }

    subsongTitle(subsong) {
        const index = subsong - this.selection.first;
        const name = this.selection.names?.[index];
        if (name) return name;
        if (this.selection.count === 1 || this.selection.count === null && this.subsong === this.selection.selected)
            return this.prepared?.title || this.currentFile.basename;
        return this.plugin.copy.track + ' ' + (index + 1);
    }

    knownDuration(subsong) {
        const duration = this.durations.get(subsong) ?? this.selection.durations?.[subsong - this.selection.first]
            ?? this.prepared?.fileDuration;
        return Number.isFinite(duration) && duration > 0 ? duration : null;
    }

    async step(direction) {
        const entry = this.entries[this.entryIndex + direction];
        if (entry) await this.selectEntry(entry);
    }

    async selectEntry(entry) {
        if (!entry.file) return this.selectSubsong(entry.subsong);
        if (entry.file === this.currentFile) return this.start();
        this.pendingFile = entry.file;
        try {
            await this.leaf.openFile(entry.file);
        } catch (error) {
            if (this.pendingFile === entry.file) this.report(error, 'openError');
        } finally {
            if (this.pendingFile === entry.file) this.pendingFile = null;
        }
    }

    async selectSubsong(subsong) {
        this.subsong = subsong;
        this.trackInput.value = String(subsong - this.selection.first + 1);
        this.updateSelection();
        await this.start();
    }

    prepare(file) {
        if (this.preparation) return this.preparation;
        const preparation = this.readTrack(file).then(prepared => {
            if (this.currentFile === file && this.preparation === preparation) {
                this.prepared = prepared;
                if (this.selection === defaultSelection) {
                    this.selection = prepared.selection;
                    this.subsong = this.selection.selected;
                }
                this.renderTracklist();
                this.update();
            }
            return prepared;
        }).catch(error => {
            if (this.preparation === preparation) this.preparation = null;
            throw error;
        });
        this.preparation = preparation;
        return preparation;
    }

    async readTrack(file) {
        const extension = file.extension.toLowerCase();
        const viewWindow = this.contentEl.ownerDocument.defaultView;
        const vault = this.plugin.app.vault;
        let bytes = await vault.readBinary(file);
        if (!bytes.byteLength) throw new PlayerError('emptyFile');
        const initialRoute = routeFile(extension, bytes);
        if (extension === 'stm' || Object.hasOwn(capsuleRates, initialRoute.id) || ['a5', 'nf', 'dcs'].includes(initialRoute.id))
            bytes = await unpackCapsule(viewWindow, bytes);
        const route = routeFile(extension, bytes);
        const selection = trackSelection(extension, bytes, route);
        const fileDuration = trackDuration(extension, bytes, route, selection.selected);
        const title = trackTitle(extension, bytes);
        return {extension, bytes, route, selection, fileDuration: selection.count === 1 ? fileDuration : null, title};
    }

    async play() {
        if (this.state === 'loading') return;
        if (this.audio && this.mediaState !== 'error') {
            try {
                if (this.audio.ended) this.audio.currentTime = 0;
                if (this.audio.paused) await this.audio.play();
                else this.audio.pause();
            } catch (error) { this.report(error); }
        } else if (['paused', 'playing'].includes(this.state)) {
            await this.playback.toggle();
        } else {
            await this.start();
        }
    }

    async start({position = 0, paused = false} = {}) {
        const file = this.currentFile;
        if (!file) return;
        this.plugin.claim(this);
        this.stop(false);
        const request = {};
        this.request = request;
        const extension = file.extension.toLowerCase();
        if (mediaFormats.has(extension)) {
            this.playMedia(file);
            return;
        }
        try {
            const viewWindow = this.contentEl.ownerDocument.defaultView;
            const playback = new DecoderPlayback(viewWindow, () => {
                if (this.request === request) this.onPlaybackChange(playback);
            }, {position, paused});
            this.playback = playback;
            playback.volume(this.plugin.volume);
            this.update();
            const prepared = await this.prepare(file);
            if (this.request !== request) return;
            const {route, bytes} = prepared;
            const subsong = this.subsong;
            const dependencies = await loadDependencies(this.plugin.app.vault, file, extension, bytes);
            if (this.request !== request) return;
            const duration = this.knownDuration(subsong) ?? trackDuration(extension, bytes, route, subsong);
            await playback.start(route, {decoder: route.id, format: route.format,
                filename: file.path, dependencies, bytes, subsong, renderMs: (duration ?? 120) * 1000}, duration);
        } catch (error) {
            if (this.request === request) this.report(error);
        }
    }

    onPlaybackChange(playback) {
        const {duration, metadata} = playback;
        const count = metadata?.tracks;
        let changed = false;
        if (Number.isInteger(count) && count > 0 && count <= 65535 && this.selection.count !== count) {
            this.selection = {...this.selection, count};
            this.subsong = Math.max(this.selection.first, Math.min(this.subsong, this.selection.first + count - 1));
            changed = true;
        }
        if (Number.isFinite(duration) && duration > 0 && this.durations.get(this.subsong) !== duration) {
            this.durations.set(this.subsong, duration);
            changed = true;
        }
        if (changed) this.renderTracklist();
        this.update();
    }

    async seek(value) {
        if (!this.canSeek || !Number.isFinite(value)) return;
        const position = Math.min(Math.max(0, value), this.duration);
        if (this.audio) {
            this.audio.currentTime = position;
            this.update();
        } else {
            await this.start({position, paused: this.state !== 'playing'});
        }
    }

    playMedia(file) {
        const audio = this.contentEl.ownerDocument.createElement('audio');
        this.audio = audio;
        this.mediaState = 'loading';
        audio.volume = this.plugin.volume;
        for (const event of ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'error']) {
            audio.addEventListener(event, () => {
                if (audio !== this.audio) return;
                if (event === 'error') this.report(new PlayerError('playbackError'));
                else {
                    if (['play', 'pause', 'ended'].includes(event))
                        this.mediaState = audio.ended ? 'ended' : audio.paused ? 'paused' : 'playing';
                    if (event === 'durationchange' && Number.isFinite(audio.duration)) {
                        this.durations.set(this.subsong, audio.duration);
                        this.renderTracklist();
                    }
                    this.update();
                }
            });
        }
        audio.src = this.plugin.app.vault.getResourcePath(file);
        this.update();
        void audio.play().catch(error => { if (this.audio === audio) this.report(error); });
    }

    report(error, fallback = 'playbackError') {
        console.warn('GremlinAmp:', error);
        if (this.playback) {
            this.playback.fail(error instanceof PlayerError ? error : new PlayerError(fallback));
        } else {
            this.error = error instanceof PlayerError ? error : new PlayerError(fallback);
            this.mediaState = 'error';
            this.update();
        }
    }

    stop(update = true) {
        this.request = null;
        this.error = null;
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

    get state() { return this.playback?.state ?? this.mediaState ?? 'stopped'; }
    get seconds() { return this.playback?.seconds ?? this.audio?.currentTime ?? 0; }
    get duration() {
        const duration = this.playback?.duration ?? this.audio?.duration ?? this.knownDuration(this.subsong);
        return Number.isFinite(duration) && duration > 0 ? duration : null;
    }
    get canSeek() {
        const ready = this.audio ? this.audio.readyState > 0 : this.playback?.metadata;
        return Boolean(ready && this.duration && !['loading', 'error'].includes(this.state));
    }

    showTime(seconds) {
        this.elapsed.textContent = timeLabel(seconds);
        this.position.setAttribute('aria-valuetext', timeLabel(seconds));
    }

    update() {
        if (!this.currentFile || !this.status) return;
        const copy = this.plugin.copy;
        const state = this.state;
        const action = state === 'playing' ? 'pause' : state === 'paused' ? 'resume' : 'play';
        if (this.playIcon !== this.playButton || this.playAction !== action) {
            setIcon(this.playButton, action === 'pause' ? 'pause' : 'play');
            this.playIcon = this.playButton;
            this.playAction = action;
        }
        this.playButton.setAttribute('aria-label', copy[action]);
        this.playButton.title = copy[action];
        this.playButton.disabled = state === 'loading';
        this.stopButton.disabled = state === 'stopped';
        this.backButton.disabled = this.forwardButton.disabled = this.position.disabled = !this.canSeek;
        this.trackInput.disabled = state === 'loading';
        const error = this.playback?.error ?? this.error;
        this.status.textContent = error ? (copy[error.key] ?? copy[this.playback?.target ? 'seekError' : 'playbackError'])
            .replace('{detail}', error.detail ?? '') : copy[state === 'loading' && this.playback?.target ? 'seeking' : state];
        this.titleEl.textContent = this.subsongTitle(this.subsong);
        this.fileEl.textContent = this.currentFile.name;
        const duration = this.duration;
        this.total.textContent = duration ? timeLabel(duration) : '–:––';
        this.total.title = duration ? '' : copy.durationUnknown;
        this.position.max = String(duration ?? 1);
        if (!this.position.matches(':active')) {
            this.position.value = String(duration ? this.seconds : 0);
            this.showTime(this.seconds);
        }
    }
}

function timeLabel(seconds) {
    const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

class GremlinAmpSettings extends PluginSettingTab {
    constructor(plugin) {
        super(plugin.app, plugin);
        this.plugin = plugin;
    }

    display() {
        this.containerEl.empty();
        const setting = new Setting(this.containerEl).setName(this.plugin.copy.language);
        setting.addDropdown(dropdown => dropdown
            .addOption('ru', 'Русский').addOption('en', 'English')
            .setValue(this.plugin.language).onChange(async language => {
                dropdown.setDisabled(true);
                try {
                    await this.plugin.setLanguage(language);
                    setting.setName(this.plugin.copy.language);
                } catch (error) {
                    console.warn('GremlinAmp:', error);
                    dropdown.setValue(this.plugin.language);
                    new Notice(this.plugin.copy.saveFailed);
                } finally {
                    dropdown.setDisabled(false);
                }
            }));
    }
}

module.exports = class GremlinAmp extends Plugin {
    volume = 0.7;
    language = 'en';

    async onload() {
        this.registerView(viewType, leaf => new MusicView(leaf, this));
        for (const extension of playerExtensions) {
            try { this.registerExtensions([extension], viewType); }
            catch (error) { console.warn('GremlinAmp could not register .' + extension, error); }
        }
        const fallback = (getLanguage?.() ?? globalThis.navigator?.language ?? 'en').toLowerCase().split('-')[0];
        this.language = fallback === 'ru' ? 'ru' : 'en';
        try {
            const data = await this.loadData();
            if (data?.language === 'ru' || data?.language === 'en') this.language = data.language;
        } catch (error) { console.warn('GremlinAmp:', error); }
        this.addSettingTab(new GremlinAmpSettings(this));
        this.refreshLanguage();
    }

    get copy() { return strings[this.language]; }

    async setLanguage(language) {
        if (language === this.language || !Object.hasOwn(strings, language)) return;
        await this.saveData({language});
        this.language = language;
        this.refreshLanguage();
    }

    refreshLanguage() {
        for (const leaf of this.app.workspace.getLeavesOfType(viewType)) leaf.view.localize?.();
    }

    claim(view) {
        if (this.active !== view) {
            this.active?.stop();
            this.active = view;
        }
    }

    onunload() {
        for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
            leaf.view.stop?.();
            leaf.detach();
        }
        this.active = null;
    }
};
