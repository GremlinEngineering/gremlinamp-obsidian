const {FileView, FuzzySuggestModal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder,
    getLanguage, setIcon, setTooltip} = require('obsidian');
const viewType = 'gremlinamp-music';
const libraryViewType = 'gremlinamp-library';
const defaultSelection = {first: 0, count: 1, selected: 0};
const byFilename = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

function withinFolder(path, folder) {
    return folder === '/' || path === folder || path.startsWith(folder + '/');
}

function isLibraryTrack(file) {
    if (!(file instanceof TFile)) return false;
    const extension = file.extension.toLowerCase();
    return playerExtensions.includes(extension) || mediaFormats.has(extension);
}

class MusicView extends FileView {
    constructor(leaf, plugin, library = false) {
        super(leaf);
        this.plugin = plugin;
        this.library = library;
        this.mode = library ? 'library' : 'file';
        if (library) {
            this.allowNoFile = true;
            this.navigation = false;
        }
    }

    getViewType() { return this.library ? libraryViewType : viewType; }
    getDisplayText() { return this.library ? 'GremlinAmp' : this.currentFile?.name ?? this.file?.name ?? 'GremlinAmp'; }
    getIcon() { return 'music'; }
    canAcceptExtension(extension) { return playerExtensions.includes(extension.toLowerCase()); }

    onload() {
        super.onload();
        const vault = this.plugin.app.vault;
        if (!this.library) {
            this.registerEvent(vault.on('create', file => this.refreshFolder(file)));
            this.registerEvent(vault.on('delete', file => this.refreshFolder(file)));
            this.registerEvent(vault.on('rename', () => {
                if (this.currentFile) {
                    this.update();
                    this.renderTracklist();
                }
            }));
        }
        this.registerEvent(vault.on('modify', file => {
            if (file === this.currentFile) this.preparation = null;
        }));
    }

    async onOpen() {
        await super.onOpen();
        if (this.library) this.renderPlayer();
    }

    async onLoadFile(file) {
        const autoplay = this.pendingFile === file;
        this.pendingFile = null;
        this.loadTrack(file);
        if (autoplay) void this.start();
        else if (!mediaFormats.has(file.extension.toLowerCase())) void this.prepare(file).catch(() => {});
    }

    loadTrack(file) {
        this.stop(false);
        this.currentFile = file;
        this.preparation = null;
        this.prepared = null;
        this.selection = defaultSelection;
        this.subsong = 0;
        this.durations = new Map();
        if (this.library) {
            this.renderTracklist();
            this.update();
        } else {
            this.renderPlayer();
        }
    }

    async onUnloadFile() { this.resetFile(); }
    async onClose() {
        this.resetFile();
        if (this.plugin.active === this) this.plugin.active = null;
    }

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

    refreshLibrary() {
        if (!this.list) return;
        const file = this.currentFile;
        if (file && (!isLibraryTrack(file) || this.plugin.app.vault.getAbstractFileByPath(file.path) !== file)) {
            this.resetFile();
            this.mode = 'library';
        }
        this.renderTracklist();
        this.update();
    }

    renderPlayer() {
        this.contentEl.empty();
        const root = this.contentEl.createDiv({cls: 'gremlinamp-player'});
        const player = root.createEl('section', {cls: 'gremlinamp-panel'});
        this.panel = player;
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
        this.collectionButton = this.button(this.scopes, null, () => this.setMode(this.library ? 'library' : 'folder'));
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
        this.emptyList = tracks.createEl('p', {cls: 'gremlinamp-empty', attr: {role: 'status'}});
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
        if (!this.list) return;
        const copy = this.plugin.copy;
        for (const [element, key] of [
            [this.previousButton, 'previous'], [this.backButton, 'back'], [this.forwardButton, 'forward'],
            [this.nextButton, 'next'], [this.stopButton, 'stop'], [this.position, 'position'],
            [this.volume, 'volume'], [this.scopes, 'source']
        ]) {
            element.setAttribute('aria-label', copy[key]);
            if (element.tagName === 'BUTTON') element.title = copy[key];
        }
        this.listTitle.textContent = this.library ? copy.library : copy.tracklist;
        this.fileButton.textContent = copy.inFile;
        this.collectionButton.textContent = this.library ? copy.inLibrary : copy.inFolder;
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
        const file = this.currentFile;
        if (!this.list || (!file && !this.library)) return;
        const focusedEntry = this.entries?.[this.rows.indexOf(this.list.ownerDocument.activeElement)];
        this.panel.hidden = this.scopes.hidden = !file;
        this.fileButton.setAttribute('aria-pressed', String(this.mode === 'file'));
        this.collectionButton.setAttribute('aria-pressed', String(this.mode !== 'file'));
        if (this.mode === 'file') {
            this.entries = Array.from({length: this.selection.count ?? 0}, (_, index) => {
                const subsong = this.selection.first + index;
                return {subsong, extension: file.extension.toUpperCase(), title: this.subsongTitle(subsong),
                    duration: this.knownDuration(subsong)};
            });
        } else {
            const files = this.library ? this.plugin.getLibraryFiles()
                : (file.parent?.children ?? [file]).filter(item => item instanceof TFile && this.canAcceptExtension(item.extension));
            this.entries = files.sort((a, b) => byFilename.compare(a.name, b.name) || byFilename.compare(a.path, b.path))
                .map(item => ({file: item, title: item.basename, extension: item.extension.toUpperCase(),
                    duration: item === file ? this.knownDuration(this.subsong) : null}));
        }
        this.emptyList.hidden = this.mode !== 'library' || this.entries.length > 0;
        this.emptyList.textContent = this.plugin.copy[this.plugin.settings.libraryFolders.length ? 'emptyLibrary' : 'noLibraryFolders'];
        this.unknownTrack.hidden = this.mode !== 'file' || this.selection.count !== null;
        if (file) {
            this.trackInput.value = String(this.subsong - this.selection.first + 1);
            this.trackInput.max = String(this.selection.max ?? 65535);
        }
        this.list.empty();
        this.rows = this.entries.map((entry, index) => {
            const button = this.button(this.list.createEl('li'), null, () => void this.selectEntry(entry));
            button.createSpan({text: String(index + 1).padStart(2, '0'), cls: 'gremlinamp-row-index'});
            const title = button.createSpan({text: entry.title, cls: 'gremlinamp-row-title'});
            if (this.mode === 'library') {
                title.createSpan({text: entry.file.parent?.path ?? '/', cls: 'gremlinamp-row-folder'});
                button.title = entry.file.path;
            }
            button.createSpan({text: entry.extension, cls: 'gremlinamp-row-format'});
            button.createSpan({text: entry.duration ? timeLabel(entry.duration) : '–:––', cls: 'gremlinamp-row-time'});
            return button;
        });
        this.updateSelection();
        if (focusedEntry) {
            const index = this.entries.findIndex(entry => entry.file === focusedEntry.file && entry.subsong === focusedEntry.subsong);
            this.rows[index]?.focus({preventScroll: true});
        }
    }

    get entryIndex() {
        return this.entries?.findIndex(entry => this.mode !== 'file'
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
        if (this.library) {
            this.loadTrack(entry.file);
            return this.start();
        }
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

class LibraryFolderPicker extends FuzzySuggestModal {
    constructor(plugin) {
        super(plugin.app);
        this.plugin = plugin;
        this.setPlaceholder(plugin.copy.chooseFolder);
        this.emptyStateText = plugin.copy.noMoreFolders;
    }

    getItems() {
        const selected = this.plugin.settings.libraryFolders;
        return this.app.vault.getAllFolders(true).filter(folder => !selected.includes(folder.path))
            .sort((a, b) => byFilename.compare(a.path, b.path));
    }

    getItemText(folder) { return folder.path === '/' ? this.plugin.copy.vaultRoot : folder.path; }

    onChooseItem(folder) {
        void this.plugin.updateSettings(settings => ({libraryFolders: [...new Set([...settings.libraryFolders, folder.path])]}));
    }
}

class GremlinAmpSettings extends PluginSettingTab {
    constructor(plugin) {
        super(plugin.app, plugin);
        this.plugin = plugin;
    }

    display() {
        this.containerEl.empty();
        this.languageSetting = new Setting(this.containerEl).setName(this.plugin.copy.language);
        this.languageSetting.addDropdown(dropdown => dropdown
            .addOption('ru', 'Русский').addOption('en', 'English')
            .setValue(this.plugin.language).onChange(async language => {
                dropdown.setDisabled(true);
                try {
                    await this.plugin.updateSettings(() => ({language}));
                } finally {
                    dropdown.setValue(this.plugin.language);
                    dropdown.setDisabled(false);
                }
            }));
        this.folderSettings = this.containerEl.createDiv();
        this.refresh();
    }

    hide() {
        this.languageSetting = null;
        this.folderSettings = null;
    }

    refresh() {
        if (!this.folderSettings) return;
        const {copy, settings} = this.plugin;
        this.languageSetting.setName(copy.language);
        this.folderSettings.empty();
        new Setting(this.folderSettings).setName(copy.libraryFolders).setDesc(copy.libraryFoldersDescription)
            .addButton(button => button.setButtonText(copy.addFolder).onClick(() => new LibraryFolderPicker(this.plugin).open()));
        for (const path of settings.libraryFolders) {
            const setting = new Setting(this.folderSettings).setName(path === '/' ? copy.vaultRoot : path);
            if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder) && path !== '/')
                setting.setDesc(copy.folderMissing);
            setting.addExtraButton(button => button.setIcon('trash-2').setTooltip(copy.removeFolder).onClick(() =>
                void this.plugin.updateSettings(current => ({libraryFolders: current.libraryFolders.filter(folder => folder !== path)}))));
        }
    }
}

module.exports = class GremlinAmp extends Plugin {
    volume = 0.7;
    settings = {language: 'en', libraryFolders: []};
    saving = Promise.resolve();

    async onload() {
        this.registerView(viewType, leaf => new MusicView(leaf, this));
        this.registerView(libraryViewType, leaf => new MusicView(leaf, this, true));
        for (const extension of playerExtensions) {
            try { this.registerExtensions([extension], viewType); }
            catch (error) { console.warn('GremlinAmp could not register .' + extension, error); }
        }
        const fallback = (getLanguage?.() ?? globalThis.navigator?.language ?? 'en').toLowerCase().split('-')[0];
        this.settings.language = fallback === 'ru' ? 'ru' : 'en';
        try {
            const data = await this.loadData();
            if (data?.language === 'ru' || data?.language === 'en') this.settings.language = data.language;
            if (Array.isArray(data?.libraryFolders))
                this.settings.libraryFolders = [...new Set(data.libraryFolders.filter(path => typeof path === 'string' && path))];
        } catch (error) { console.warn('GremlinAmp:', error); }
        this.ribbon = this.addRibbonIcon('music', this.copy.openLibrary, () => this.openLibrary());
        this.libraryCommand = this.addCommand({id: 'open-library', name: this.copy.openLibrary, callback: () => this.openLibrary()});
        this.settingTab = new GremlinAmpSettings(this);
        this.addSettingTab(this.settingTab);
        const {vault} = this.app;
        this.registerEvent(vault.on('create', file => this.onLibraryChange(file)));
        this.registerEvent(vault.on('delete', file => this.onLibraryChange(file)));
        this.registerEvent(vault.on('rename', (file, previousPath) => this.onLibraryChange(file, previousPath)));
        this.refreshLanguage();
    }

    get language() { return this.settings.language; }
    get copy() { return strings[this.language]; }

    updateSettings(change) {
        this.saving = this.saving.then(async () => {
            const previous = this.settings;
            const patch = change(previous);
            if (Object.entries(patch).every(([key, value]) => previous[key] === value)) return;
            const updated = {...previous, ...patch};
            await this.saveData(updated);
            this.settings = updated;
            if (updated.libraryFolders !== previous.libraryFolders) this.refreshLibrary();
            if (updated.language !== previous.language) this.refreshLanguage();
            this.settingTab.refresh();
        }).catch(error => {
            console.warn('GremlinAmp:', error);
            new Notice(this.copy.saveFailed);
        });
        return this.saving;
    }

    refreshLanguage() {
        setTooltip(this.ribbon, this.copy.openLibrary, {placement: 'right'});
        this.ribbon.setAttribute('aria-label', this.copy.openLibrary);
        this.libraryCommand.name = this.manifest.name + ': ' + this.copy.openLibrary;
        for (const type of [viewType, libraryViewType]) {
            for (const leaf of this.app.workspace.getLeavesOfType(type)) leaf.view.localize?.();
        }
    }

    openLibrary() {
        if (this.openingLibrary) return this.openingLibrary;
        const {workspace} = this.app;
        this.openingLibrary = Promise.resolve().then(async () => {
            let leaf = workspace.getLeavesOfType(libraryViewType)[0];
            if (!leaf) {
                leaf = workspace.getLeaf('tab');
                await leaf.setViewState({type: libraryViewType, active: true});
            }
            await workspace.revealLeaf(leaf);
        }).catch(error => {
            console.warn('GremlinAmp:', error);
            new Notice(this.copy.openLibraryError);
        }).finally(() => { this.openingLibrary = null; });
        return this.openingLibrary;
    }

    getLibraryFiles() {
        const {vault} = this.app;
        const stack = this.settings.libraryFolders.map(path => path === '/' ? vault.getRoot() : vault.getAbstractFileByPath(path))
            .filter(item => item instanceof TFolder);
        const seen = new Set();
        const files = [];
        while (stack.length) {
            const item = stack.pop();
            if (!item || seen.has(item.path)) continue;
            seen.add(item.path);
            if (item instanceof TFolder) {
                for (const child of item.children) stack.push(child);
            } else if (isLibraryTrack(item)) {
                files.push(item);
            }
        }
        return files;
    }

    onLibraryChange(file, previousPath) {
        const {libraryFolders} = this.settings;
        const path = file.path;
        const folderChanged = file instanceof TFolder;
        if (!folderChanged && !previousPath && !isLibraryTrack(file)) return;
        if (folderChanged && previousPath) {
            // Resolve against the latest settings, including any previous rename still being saved.
            void this.updateSettings(settings => {
                const folders = settings.libraryFolders;
                if (!folders.some(folder => withinFolder(folder, previousPath))) return {};
                return {libraryFolders: [...new Set(folders.map(folder => withinFolder(folder, previousPath)
                    ? path + folder.slice(previousPath.length) : folder))]};
            });
        }
        const touchesLibrary = changedPath => changedPath && libraryFolders.some(folder => withinFolder(changedPath, folder)
            || folderChanged && withinFolder(folder, changedPath));
        const selectedFileChanged = this.app.workspace.getLeavesOfType(libraryViewType).some(({view}) => {
            const selected = view.currentFile;
            return selected && (selected === file || folderChanged && withinFolder(selected.path, path));
        });
        if (touchesLibrary(path) || touchesLibrary(previousPath) || selectedFileChanged) {
            this.refreshFolderSettings ||= folderChanged;
            if (this.libraryRefresh !== undefined) return;
            this.libraryRefresh = setTimeout(() => {
                this.libraryRefresh = undefined;
                this.refreshLibrary();
                if (this.refreshFolderSettings) this.settingTab.refresh();
                this.refreshFolderSettings = false;
            }, 0);
        }
    }

    refreshLibrary() {
        for (const leaf of this.app.workspace.getLeavesOfType(libraryViewType)) leaf.view.refreshLibrary?.();
    }

    claim(view) {
        if (this.active !== view) {
            this.active?.stop();
            this.active = view;
        }
    }

    onunload() {
        clearTimeout(this.libraryRefresh);
        for (const type of [viewType, libraryViewType]) {
            for (const leaf of this.app.workspace.getLeavesOfType(type)) {
                leaf.view.stop?.();
                leaf.detach();
            }
        }
        this.active = null;
    }
};
