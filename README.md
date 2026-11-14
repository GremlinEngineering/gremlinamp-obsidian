# GremlinAmp

An offline player for GremlinAmp's game music formats in Obsidian. Open a track from the file explorer or a normal wiki link such as `[[Music/intro.nsf]]`, then press **Play**. The player inherits the active Obsidian theme. **In file** shows subsongs, and **In folder** lists other supported music files in the same folder. Use the position slider or the 10-second buttons for tracks with a known duration after loading. Choose **English** or **Русский** in the GremlinAmp settings. Obsidian reads the original file from the vault. The decoder runs in a local Worker.

## Installing

In BRAT, choose **Add beta plugin** and enter the URL of this repository. Choose the latest release. The release contains the standard `main.js`, `manifest.json` and `styles.css` assets. The complete WASM decoder set is embedded in `main.js`.

For manual installation, extract the release ZIP in the vault's `.obsidian/plugins` directory and enable **GremlinAmp** in **Community plugins**. The plugin needs no network or separate player after installation.

## Files

| Family | Extensions |
| --- | --- |
| Trackers | `mod`, `xm`, `s3m`, `it`, `mtm`, `stm` |
| Game Music Emu | `ay`, `gym`, `hes`, `nsf`, `nsfe`, `sap`, `spc`, `sgc`, `gbs` |
| MSX and C64 | `kss`, `kssx`, `kscc`, `sid`, `psid`, `rsid` |
| VGM and related streams | `vgm`, `vgz`, `s98`, `tmc`, `xa` |
| Portable Sound Format | `psf`, `minipsf`, `psf2`, `minipsf2`, `minips2`, `gsf`, `minigsf`, `usf`, `miniusf`, `ssf`, `minissf`, `dsf`, `minidsf` |
| Atari and WonderSwan | `a26`, `a78`, `wsr` |
| GremlinAmp containers | `a5m`, `a5z`, `acm`, `acz`, `agm`, `agz`, `bms`, `bmz`, `c3m`, `c3z`, `dcm`, `dcz`, `dkm`, `e6m`, `e6z`, `f3m`, `f3z`, `g0m`, `g0z`, `gbm`, `gbz`, `ivm`, `ivz`, `jgm`, `jgz`, `k0m`, `k0z`, `kim`, `kiz`, `lsm`, `lsz`, `m2s`, `m2z`, `mdm`, `mdz`, `mrm`, `nfm`, `nfz`, `ngl`, `ngz`, `nws`, `nwz`, `snes-registers`, `spt`, `spz`, `stm`, `stz`, `svm`, `svz`, `vxm`, `vxz`, `wsm`, `wsz` |
| Regular audio | `aac` and `oga` through the app's media engine. Formats such as WAV, MP3, OGG, FLAC and M4A open in Obsidian's native player. |

Keep any referenced music libraries such as `.psflib` or `.gsflib` at their original relative paths within the vault. They belong to the track set. When a duration is available, the player stops at the end. Seeking in some emulated formats can take longer because the decoder has to replay up to the requested point. Some emulated formats loop until stopped. Untimed GSF files use a two-minute playback window.

## Building

Run `python3 tools/build.py`. The build is offline and uses only Python's standard library. It writes the three release assets and the manual-install ZIP to `dist/`. See [decoder notices](THIRD_PARTY_NOTICES.md) for sources and licenses.

The same distribution targets desktop and mobile through the documented Obsidian API, Web Workers, WebAssembly and Web Audio. The decoder and audio path has been tested in isolated Chromium on macOS. Actual Obsidian installations on macOS, Windows, Linux, Android and iOS require platform testing.
