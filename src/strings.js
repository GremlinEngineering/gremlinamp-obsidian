const strings = {
    en: {
        language: 'Plugin language', saveFailed: 'Could not save the GremlinAmp settings.',
        play: 'Play', pause: 'Pause', resume: 'Resume', stop: 'Stop', previous: 'Previous track',
        next: 'Next track', back: 'Back 10 seconds', forward: 'Forward 10 seconds',
        volume: 'Volume', position: 'Playback position', tracklist: 'Tracklist',
        inFile: 'In file', inFolder: 'In folder', inLibrary: 'In library', source: 'Tracklist source',
        library: 'Music library', openLibrary: 'Open music library', openLibraryError: 'Could not open the GremlinAmp library.',
        libraryFolders: 'Library folders', libraryFoldersDescription: 'Choose vault folders to watch. Subfolders are included.',
        addFolder: 'Add folder', removeFolder: 'Remove folder from library', vaultRoot: 'Vault root (/)',
        chooseFolder: 'Search vault folders…', noMoreFolders: 'No matching folders', folderMissing: 'Folder not found in the vault.',
        noLibraryFolders: 'Add folders in Settings → GremlinAmp → Library folders.',
        emptyLibrary: 'No supported music files in the selected folders.',
        track: 'Track', chooseTrack: 'Track number', loading: 'Loading track…',
        seeking: 'Seeking…', playing: 'Playing', paused: 'Paused', ended: 'Track ended',
        stopped: 'Ready', durationUnknown: 'Duration unavailable',
        playbackError: 'Could not play this file. Check its format and any required libraries.',
        seekError: 'Could not seek to that position.', emptyFile: 'The music file is empty.',
        missingLibrary: 'Required library not found: {detail}',
        invalidLibrary: 'Invalid library path or circular reference: {detail}',
        openError: 'Could not open the selected file.'
    },
    ru: {
        language: 'Язык плагина', saveFailed: 'Не удалось сохранить настройки GremlinAmp.',
        play: 'Играть', pause: 'Пауза', resume: 'Продолжить', stop: 'Стоп', previous: 'Предыдущая дорожка',
        next: 'Следующая дорожка', back: 'Назад на 10 секунд', forward: 'Вперёд на 10 секунд',
        volume: 'Громкость', position: 'Позиция композиции', tracklist: 'Треклист',
        inFile: 'В файле', inFolder: 'В папке', inLibrary: 'В медиатеке', source: 'Источник треклиста',
        library: 'Медиатека', openLibrary: 'Открыть медиатеку', openLibraryError: 'Не удалось открыть медиатеку GremlinAmp.',
        libraryFolders: 'Папки медиатеки', libraryFoldersDescription: 'Выберите папки хранилища. Вложенные папки включаются автоматически.',
        addFolder: 'Добавить папку', removeFolder: 'Исключить папку из медиатеки', vaultRoot: 'Корень хранилища (/)',
        chooseFolder: 'Поиск папок хранилища…', noMoreFolders: 'Подходящих папок нет', folderMissing: 'Папка отсутствует в хранилище.',
        noLibraryFolders: 'Добавьте папки в разделе Настройки → GremlinAmp → Папки медиатеки.',
        emptyLibrary: 'В выбранных папках нет поддерживаемых музыкальных файлов.',
        track: 'Дорожка', chooseTrack: 'Номер дорожки', loading: 'Подготовка трека…',
        seeking: 'Перемотка…', playing: 'Играет', paused: 'Пауза', ended: 'Трек завершён',
        stopped: 'Готово к воспроизведению', durationUnknown: 'Длительность неизвестна',
        playbackError: 'Не удалось воспроизвести файл. Проверьте формат и файлы библиотек.',
        seekError: 'Не удалось перейти к этой позиции.', emptyFile: 'Музыкальный файл пуст.',
        missingLibrary: 'Не найдена библиотека {detail}',
        invalidLibrary: 'Недопустимый путь или циклическая зависимость: {detail}',
        openError: 'Не удалось открыть выбранный файл.'
    }
};

class PlayerError extends Error {
    constructor(key, detail = '') {
        super(detail || key);
        this.key = key;
        this.detail = detail;
    }
}
