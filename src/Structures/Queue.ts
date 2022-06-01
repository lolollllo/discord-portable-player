import { Collection, Guild, StageChannel, VoiceChannel, Snowflake, SnowflakeUtil, GuildChannelResolvable, ChannelType } from "discord.js";
import { Player } from "../Player";
import { StreamDispatcher } from "../VoiceInterface/StreamDispatcher";
import Track from "./Track";
import { PlayerOptions, PlayerProgressbarOptions, PlayOptions, QueueFilters, LoopMode, TrackSource } from "../types/types";
import ytdl from "discord-ytdl-core";
import { AudioResource, StreamType } from "@discordjs/voice";
import { Util } from "../utils/Util";
import YouTube from "youtube-sr";
import AudioFilters from "../utils/AudioFilters";
import { PlayerError, ErrorStatusCode } from "./PlayerError";
import type { Readable } from "stream";
import { VolumeTransformer } from "../VoiceInterface/VolumeTransformer";

class Queue<T = unknown> {
    public readonly guild: Guild;
    public readonly player: Player;
    public connection: StreamDispatcher;
    public tracks: Track[] = [];
    public previousTracks: Track[] = [];
    public options: PlayerOptions;
    public playing = false;
    public metadata?: T = null;
    public loopMode: LoopMode = 0;
    public readonly id: Snowflake = SnowflakeUtil.generate();
    private _streamTime = 0;
    public _cooldownsTimeout = new Collection<string, NodeJS.Timeout>();
    private _activeFilters: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    private _filtersUpdate = false;
    #lastVolume = 0;
    #destroyed = false;
    public onBeforeCreateStream: (track: Track, source: TrackSource, queue: Queue) => Promise<Readable | undefined> = null;

    /**
     * Queue constructor
     * @param {Player} player The player that instantiated this queue
     * @param {Guild} guild The guild that instantiated this queue
     * @param {PlayerOptions} [options={}] Player options for the queue
     */
    constructor(player: Player, guild: Guild, options: PlayerOptions = {}) {
        /**
         * The player that instantiated this queue
         * @type {Player}
         * @readonly
         */
        this.player = player;

        /**
         * The guild that instantiated this queue
         * @type {Guild}
         * @readonly
         */
        this.guild = guild;

        /**
         * The player options for this queue
         * @type {PlayerOptions}
         */
        this.options = {};

        /**
         * Queue loop mode
         * @type {LoopMode}
         * @name Queue#LoopMode
         */

        /**
         * Queue metadata
         * @type {any}
         * @name Queue#metadata
         */

        /**
         * Previous tracks
         * @type {Track[]}
         * @name Queue#previousTracks
         */

        /**
         * Regular tracks
         * @type {Track[]}
         * @name Queue#tracks
         */

        /**
         * The connection
         * @type {StreamDispatcher}
         * @name Queue#connection
         */

        /**
         * The ID of this queue
         * @type {Snowflake}
         * @name Queue#id
         */

        Object.assign(
            this.options,
            {
                leaveOnEnd: true,
                leaveOnStop: true,
                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 1000,
                autoSelfDeaf: true,
                ytdlOptions: {
                    highWaterMark: 1 << 25
                },
                initialVolume: 100,
                bufferingTimeout: 3000,
                spotifyBridge: true,
                disableVolume: false
            } as PlayerOptions,
            options
        );

        if ("onBeforeCreateStream" in this.options) this.onBeforeCreateStream = this.options.onBeforeCreateStream;

        this.player.emit("debug", this, `Queue initialized:\n\n${this.player.scanDeps()}`);
    }

    /**
     * Returns current track
     * @type {Track}
     */
    get current() {
        if (this.#watchDestroyed()) return;
        return this.connection.audioResource?.metadata ?? this.tracks[0];
    }

    /**
     * If this queue is destroyed
     * @type {boolean}
     */
    get destroyed() {
        return this.#destroyed;
    }

    /**
     * Returns current track
     * @returns {Track}
     */
    nowPlaying() {
        if (this.#watchDestroyed()) return;
        return this.current;
    }

    /**
     * Connects to a voice channel
     * @param {GuildChannelResolvable} channel The voice/stage channel
     * @returns {Promise<Queue>}
     */
    async connect(channel: GuildChannelResolvable) {
        if (this.#watchDestroyed()) return;
        const _channel = this.guild.channels.resolve(channel) as StageChannel | VoiceChannel;
        if (![ChannelType.GuildStageVoice, ChannelType.GuildVoice].includes(_channel?.type))
            throw new PlayerError(`Channel type must be GuildVoice or GuildStageVoice, got ${_channel?.type}!`, ErrorStatusCode.INVALID_ARG_TYPE);
        const connection = await this.player.voiceUtils.connect(_channel, {
            deaf: this.options.autoSelfDeaf
        });
        this.connection = connection;

        if (_channel.type === ChannelType.GuildStageVoice) {
            await _channel.guild.me.voice.setSuppressed(false).catch(async () => {
                return await _channel.guild.members.me.voice.setRequestToSpeak(true).catch(Util.noop);
            });
        }

        this.connection.on("error", (err) => {
            if (this.#watchDestroyed(false)) return;
            this.player.emit("connectionError", this, err);
        });
        this.connection.on("debug", (msg) => {
            if (this.#watchDestroyed(false)) return;
            this.player.emit("debug", this, msg);
        });

        this.player.emit("connectionCreate", this, this.connection);

        this.connection.on("start", (resource) => {
            if (this.#watchDestroyed(false)) return;
            this.playing = true;
            if (!this._filtersUpdate && resource?.metadata) this.player.emit("trackStart", this, resource?.metadata ?? this.current);
            this._filtersUpdate = false;
        });

        this.connection.on("finish", async (resource) => {
            if (this.#watchDestroyed(false)) return;
            this.playing = false;
            if (this._filtersUpdate) return;
            this._streamTime = 0;
            if (resource && resource.metadata) this.previousTracks.push(resource.metadata);

            this.player.emit("trackEnd", this, resource.metadata);

            if (!this.tracks.length && this.loopMode === LoopMode.Off) {
                if (this.options.leaveOnEnd) this.destroy();
                this.player.emit("queueEnd", this);
            } else if (!this.tracks.length && this.loopMode === LoopMode.Autoplay) {
                this._handleAutoplay(Util.last(this.previousTracks));
            } else {
                if (this.loopMode === LoopMode.Track) return void this.play(Util.last(this.previousTracks), { immediate: true });
                if (this.loopMode === LoopMode.Queue) this.tracks.push(Util.last(this.previousTracks));
                const nextTrack = this.tracks.shift();
                this.play(nextTrack, { immediate: true });
                return;
            }
        });

        await this.player.voiceUtils.enterReady(this.connection.voiceConnection, {
            maxTime: this.player.options.connectionTimeout || 30_000
        });

        return this;
    }

    /**
     * Destroys this queue
     * @param {boolean} [disconnect=this.options.leaveOnStop] If it should leave on destroy
     * @returns {void}
     */
    destroy(disconnect = this.options.leaveOnStop) {
        if (this.#watchDestroyed()) return;
        this.#destroyed = true;
        if (this.connection) this.connection.end();
        if (disconnect) this.connection?.disconnect();
        this.player.queues.delete(this.guild.id);
        this.player.voiceUtils.cache.delete(this.guild.id);
    }

    /**
     * Skips current track
     * @returns {boolean}
     */
    skip() {
        if (this.#watchDestroyed()) return;
        if (!this.connection) return false;
        this._filtersUpdate = false;
        this.connection.end();
        return true;
    }

    /**
     * Adds single track to the queue
     * @param {Track} track The track to add
     * @returns {void}
     */
    addTrack(track: Track) {
        if (this.#watchDestroyed()) return;
        if (!(track instanceof Track)) throw new PlayerError("invalid track", ErrorStatusCode.INVALID_TRACK);
        this.tracks.push(track);
        this.player.emit("trackAdd", this, track);
    }

    /**
     * Adds multiple tracks to the queue
     * @param {Track[]} tracks Array of tracks to add
     */
    addTracks(tracks: Track[]) {
        if (this.#watchDestroyed()) return;
        if (!tracks.every((y) => y instanceof Track)) throw new PlayerError("invalid track", ErrorStatusCode.INVALID_TRACK);
        this.tracks.push(...tracks);
        this.player.emit("tracksAdd", this, tracks);
    }

    /**
     * Sets paused state
     * @param {boolean} paused The paused state
     * @returns {boolean}
     */
    setPaused(paused?: boolean) {
        if (this.#watchDestroyed()) return;
        if (!this.connection) return false;
        return paused ? this.connection.pause(true) : this.connection.resume();
    }

    /**
     * Sets bitrate
     * @param  {number|auto} bitrate bitrate to set
     * @returns {void}
     */
    setBitrate(bitrate: number | "auto") {
        if (this.#watchDestroyed()) return;
        if (!this.connection?.audioResource?.encoder) return;
        if (bitrate === "auto") bitrate = this.connection.channel?.bitrate ?? 64000;
        this.connection.audioResource.encoder.setBitrate(bitrate);
    }

    /**
     * Sets volume
     * @param {number} amount The volume amount
     * @returns {boolean}
     */
    setVolume(amount: number) {
        if (this.#watchDestroyed()) return;
        if (!this.connection) return false;
        this.#lastVolume = amount;
        this.options.initialVolume = amount;
        return this.connection.setVolume(amount);
    }
    /**
     * Sets loop mode
     * @param {LoopMode} loopmode The loop mode
     * @returns {boolean}
     */
    setLoop(loopmode: LoopMode) {
        if (this.#watchDestroyed()) return;
        if (![LoopMode.Off, LoopMode.Queue, LoopMode.Track, LoopMode.Autoplay].includes(loopmode))
            throw new PlayerError(`Unknown loop mode "${loopmode}"!`, ErrorStatusCode.UNKNOWN_REPEAT_MODE);
        if (loopmode === this.loopMode) return false;
        this.loopMode = loopmode;
        return true;
    }

    /**
     * The current volume amount
     * @type {number}
     */
    get volume() {
        if (this.#watchDestroyed()) return;
        if (!this.connection) return 100;
        return this.connection.volume;
    }

    set volume(amount: number) {
        this.setVolume(amount);
    }

    /**
     * The stream time of this queue
     * @type {number}
     */
    get streamTime() {
        if (this.#watchDestroyed()) return;
        if (!this.connection) return 0;
        const playbackTime = this._streamTime + this.connection.streamTime;
        const NC = this._activeFilters.includes("nightcore") ? 1.25 : null;
        const VW = this._activeFilters.includes("vaporwave") ? 0.8 : null;

        if (NC && VW) return playbackTime * (NC + VW);
        return NC ? playbackTime * NC : VW ? playbackTime * VW : playbackTime;
    }

    set streamTime(time: number) {
        if (this.#watchDestroyed()) return;
        this.seek(time);
    }

    /**
     * Returns enabled filters
     * @returns {AudioFilters}
     */
    getFiltersEnabled() {
        if (this.#watchDestroyed()) return;
        return AudioFilters.names.filter((x) => this._activeFilters.includes(x));
    }

    /**
     * Returns disabled filters
     * @returns {AudioFilters}
     */
    getFiltersDisabled() {
        if (this.#watchDestroyed()) return;
        return AudioFilters.names.filter((x) => !this._activeFilters.includes(x));
    }

    /**
     * Sets filters
     * @param {QueueFilters} filters Queue filters
     * @returns {Promise<void>}
     */
    async setFilters(filters?: QueueFilters) {
        if (this.#watchDestroyed()) return;
        if (!filters || !Object.keys(filters).length) {
            // reset filters
            const streamTime = this.streamTime;
            this._activeFilters = [];
            return await this.play(this.current, {
                immediate: true,
                filtersUpdate: true,
                seek: streamTime,
                encoderArgs: []
            });
        }

        const _filters: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

        for (const filter in filters) {
            if (filters[filter as keyof QueueFilters] === true) _filters.push(filter);
        }

        if (this._activeFilters.join("") === _filters.join("")) return;

        const newFilters = AudioFilters.create(_filters).trim();
        const streamTime = this.streamTime;
        this._activeFilters = _filters;

        return await this.play(this.current, {
            immediate: true,
            filtersUpdate: true,
            seek: streamTime,
            encoderArgs: !_filters.length ? undefined : ["-af", newFilters]
        });
    }

    /**
     * Seeks to the given time
     * @param {number} position The position
     * @returns {boolean}
     */
    async seek(position: number) {
        if (this.#watchDestroyed()) return;
        if (!this.playing || !this.current) return false;
        if (position < 1) position = 0;
        if (position >= this.current.durationMS) return this.skip();

        await this.play(this.current, {
            immediate: true,
            filtersUpdate: true, // to stop events
            seek: position
        });

        return true;
    }

    /**
     * Plays previous track
     * @returns {Promise<void>}
     */
    async back() {
        if (this.#watchDestroyed()) return;
        const prev = this.previousTracks[this.previousTracks.length - 2]; // because last item is the current track
        if (!prev) throw new PlayerError("Could not find previous track", ErrorStatusCode.TRACK_NOT_FOUND);

        return await this.play(prev, { immediate: true });
    }

    /**
     * Clear this queue
     */
    clear() {
        if (this.#watchDestroyed()) return;
        this.tracks = [];
        this.previousTracks = [];
    }

    /**
     * Stops the player
     * @returns {void}
     */
    stop() {
        if (this.#watchDestroyed()) return;
        return this.destroy();
    }

    /**
     * Shuffles this queue
     * @returns {boolean}
     */
    shuffle() {
        if (this.#watchDestroyed()) return;
        if (!this.tracks.length || this.tracks.length < 3) return false;
        const currentTrack = this.tracks.shift();

        for (let i = this.tracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
        }

        this.tracks.unshift(currentTrack);

        return true;
    }

    /**
     * Removes a track from the queue
     * @param {Track|Snowflake|number} track The track to remove
     * @returns {Track}
     */
    remove(track: Track | Snowflake | number) {
        if (this.#watchDestroyed()) return;
        let trackFound: Track = null;
        if (typeof track === "number") {
            trackFound = this.tracks[track];
            if (trackFound) {
                this.tracks = this.tracks.filter((t) => t.id !== trackFound.id);
            }
        } else {
            trackFound = this.tracks.find((s) => s.id === (track instanceof Track ? track.id : track));
            if (trackFound) {
                this.tracks = this.tracks.filter((s) => s.id !== trackFound.id);
            }
        }

        return trackFound;
    }

    /**
     * Returns the index of the specified track. If found, returns the track index else returns -1.
     * @param {number|Track|Snowflake} track The track
     * @returns {number}
     */
    getTrackPosition(track: number | Track | Snowflake) {
        if (this.#watchDestroyed()) return;
        if (typeof track === "number") return this.tracks[track] != null ? track : -1;
        return this.tracks.findIndex((pred) => pred.id === (track instanceof Track ? track.id : track));
    }

    /**
     * Jumps to particular track
     * @param {Track|number} track The track
     * @returns {void}
     */
    jump(track: Track | number): void {
        if (this.#watchDestroyed()) return;
        const foundTrack = this.remove(track);
        if (!foundTrack) throw new PlayerError("Track not found", ErrorStatusCode.TRACK_NOT_FOUND);

        this.tracks.splice(0, 0, foundTrack);

        return void this.skip();
    }

    /**
     * Jumps to particular track, removing other tracks on the way
     * @param {Track|number} track The track
     * @returns {void}
     */
    skipTo(track: Track | number): void {
        if (this.#watchDestroyed()) return;
        const trackIndex = this.getTrackPosition(track);
        const removedTrack = this.remove(track);
        if (!removedTrack) throw new PlayerError("Track was not found", ErrorStatusCode.TRACK_NOT_FOUND);

        this.tracks.splice(0, trackIndex, removedTrack);

        return void this.skip();
    }

    /**
     * Inserts the given track to specified index
     * @param {Track} track The track to insert
     * @param {number} [index=0] The index where this track should be
     */
    insert(track: Track, index = 0) {
        if (this.#watchDestroyed()) return;
        if (!track || !(track instanceof Track)) throw new PlayerError("track must be the instance of Track", ErrorStatusCode.INVALID_TRACK);
        if (typeof index !== "number" || index < 0 || !Number.isFinite(index)) throw new PlayerError(`Invalid index "${index}"`, ErrorStatusCode.INVALID_ARG_TYPE);

        this.tracks.splice(index, 0, track);

        this.player.emit("trackAdd", this, track);
    }

    /**
     * @typedef {object} PlayerTimestamp
     * @property {string} current The current progress
     * @property {string} end The total time
     * @property {number} progress Progress in %
     */

    /**
     * Returns player stream timestamp
     * @returns {PlayerTimestamp}
     */
    getPlayerTimestamp() {
        if (this.#watchDestroyed()) return;
        const currentStreamTime = this.streamTime;
        const totalTime = this.current.durationMS;

        const currentTimecode = Util.buildTimeCode(Util.parseMS(currentStreamTime));
        const endTimecode = Util.buildTimeCode(Util.parseMS(totalTime));

        return {
            current: currentTimecode,
            end: endTimecode,
            progress: Math.round((currentStreamTime / totalTime) * 100)
        };
    }

    /**
     * Creates progress bar string
     * @param {PlayerProgressbarOptions} options The progress bar options
     * @returns {string}
     */
    createProgressBar(options: PlayerProgressbarOptions = { timecodes: true }) {
        if (this.#watchDestroyed()) return;
        const length = typeof options.length === "number" ? (options.length <= 0 || options.length === Infinity ? 15 : options.length) : 15;

        const index = Math.round((this.streamTime / this.current.durationMS) * length);
        const indicator = typeof options.indicator === "string" && options.indicator.length > 0 ? options.indicator : "🔘";
        const line = typeof options.line === "string" && options.line.length > 0 ? options.line : "▬";

        if (index >= 1 && index <= length) {
            const bar = line.repeat(length - 1).split("");
            bar.splice(index, 0, indicator);
            if (options.timecodes) {
                const timestamp = this.getPlayerTimestamp();
                return `${timestamp.current} ┃ ${bar.join("")} ┃ ${timestamp.end}`;
            } else {
                return `${bar.join("")}`;
            }
        } else {
            if (options.timecodes) {
                const timestamp = this.getPlayerTimestamp();
                return `${timestamp.current} ┃ ${indicator}${line.repeat(length - 1)} ┃ ${timestamp.end}`;
            } else {
                return `${indicator}${line.repeat(length - 1)}`;
            }
        }
    }

    /**
     * Total duration
     * @type {Number}
     */
    get totalTime(): number {
        if (this.#watchDestroyed()) return;
        return this.tracks.length > 0 ? this.tracks.map((t) => t.durationMS).reduce((p, c) => p + c) : 0;
    }

    /**
     * Play stream in a voice/stage channel
     * @param {Track} [src] The track to play (if empty, uses first track from the queue)
     * @param {PlayOptions} [options={}] The options
     * @returns {Promise<void>}
     */
    async play(src?: Track, options: PlayOptions = {}): Promise<void> {
        if (this.#watchDestroyed(false)) return;
        if (!this.connection || !this.connection.voiceConnection) throw new PlayerError("Voice connection is not available, use Queue#connect()!", ErrorStatusCode.NO_CONNECTION);
        if (src && (this.playing || this.tracks.length) && !options.immediate) return this.addTrack(src);
        const track = options.filtersUpdate && !options.immediate ? src || this.current : src ?? this.tracks.shift();
        if (!track) return;

        this.player.emit("debug", this, "Received play request");

        if (!options.filtersUpdate) {
            this.previousTracks = this.previousTracks.filter((x) => x.id !== track.id);
            this.previousTracks.push(track);
        }

        let stream = null;
        const customDownloader = typeof this.onBeforeCreateStream === "function";

        if (["youtube", "spotify", "applemusic"].includes(track.raw.source)) {
            let spotifyResolved = false;
            if (this.options.spotifyBridge && track.raw.source === "spotify" && !track.raw.engine) {
                track.raw.engine = await YouTube.search(`${track.author} ${track.title}`, { type: "video" })
                    .then((x) => x[0].url)
                    .catch(() => null);
                spotifyResolved = true;
            }
            const link = track.raw.source === "spotify" ? track.raw.engine : track.url;
            if (!link) return void this.play(this.tracks.shift(), { immediate: true });

            if (customDownloader) {
                stream = (await this.onBeforeCreateStream(track, spotifyResolved ? "youtube" : track.raw.source, this)) ?? null;
                if (stream)
                    stream = ytdl
                        .arbitraryStream(stream, {
                            opusEncoded: false,
                            fmt: "s16le",
                            encoderArgs: options.encoderArgs ?? this._activeFilters.length ? ["-af", AudioFilters.create(this._activeFilters)] : [],
                            seek: options.seek ? options.seek / 1000 : 0
                        })
                        .on("error", (err) => {
                            return err.message.toLowerCase().includes("premature close") ? null : this.player.emit("error", this, err);
                        });
            } else {
                stream = ytdl(link, {
                    ...this.options.ytdlOptions,
                    // discord-ytdl-core
                    opusEncoded: false,
                    fmt: "s16le",
                    encoderArgs: options.encoderArgs ?? this._activeFilters.length ? ["-af", AudioFilters.create(this._activeFilters)] : [],
                    seek: options.seek ? options.seek / 1000 : 0
                }).on("error", (err) => {
                    return err.message.toLowerCase().includes("premature close") ? null : this.player.emit("error", this, err);
                });
            }
        } else {
            const tryArb = (customDownloader && (await this.onBeforeCreateStream(track, track.raw.source || track.raw.engine, this))) || null;
            const arbitrarySource = tryArb
                ? tryArb
                : track.raw.source === "soundcloud"
                ? await track.raw.engine.downloadProgressive()
                : typeof track.raw.engine === "function"
                ? await track.raw.engine()
                : track.raw.engine;
            stream = ytdl
                .arbitraryStream(arbitrarySource, {
                    opusEncoded: false,
                    fmt: "s16le",
                    encoderArgs: options.encoderArgs ?? this._activeFilters.length ? ["-af", AudioFilters.create(this._activeFilters)] : [],
                    seek: options.seek ? options.seek / 1000 : 0
                })
                .on("error", (err) => {
                    return err.message.toLowerCase().includes("premature close") ? null : this.player.emit("error", this, err);
                });
        }

        const resource: AudioResource<Track> = this.connection.createStream(stream, {
            type: StreamType.Raw,
            data: track,
            disableVolume: Boolean(this.options.disableVolume)
        });

        if (options.seek) this._streamTime = options.seek;
        this._filtersUpdate = options.filtersUpdate;

        const volumeTransformer = resource.volume as VolumeTransformer;
        if (volumeTransformer?.hasSmoothness && typeof this.options.volumeSmoothness === "number") {
            if (typeof volumeTransformer.setSmoothness === "function") volumeTransformer.setSmoothness(this.options.volumeSmoothness || 0);
        }

        this.setVolume(this.options.initialVolume);

        setTimeout(() => {
            this.connection.playStream(resource);
        }, this.#getBufferingTimeout()).unref();
    }

    /**
     * Private method to handle autoplay
     * @param {Track} track The source track to find its similar track for autoplay
     * @returns {Promise<void>}
     * @private
     */
    private async _handleAutoplay(track: Track): Promise<void> {
        if (this.#watchDestroyed()) return;
        if (!track || ![track.source, track.raw?.source].includes("youtube")) {
            if (this.options.leaveOnEnd) this.destroy();
            return void this.player.emit("queueEnd", this);
        }
        const info = await YouTube.getVideo(track.url)
            .then((x) => x.videos[0])
            .catch(Util.noop);
        if (!info) {
            if (this.options.leaveOnEnd) this.destroy();
            return void this.player.emit("queueEnd", this);
        }

        const nextTrack = new Track(this.player, {
            title: info.title,
            url: `https://www.youtube.com/watch?v=${info.id}`,
            duration: info.durationFormatted ? Util.buildTimeCode(Util.parseMS(info.duration * 1000)) : "0:00",
            description: "",
            thumbnail: typeof info.thumbnail === "string" ? info.thumbnail : info.thumbnail.url,
            views: info.views,
            author: info.channel.name,
            requestedBy: track.requestedBy,
            source: "youtube"
        });

        this.play(nextTrack, { immediate: true });
    }

    *[Symbol.iterator]() {
        if (this.#watchDestroyed()) return;
        yield* this.tracks;
    }

    /**
     * JSON representation of this queue
     * @returns {object}
     */
    toJSON() {
        if (this.#watchDestroyed()) return;
        return {
            id: this.id,
            guild: this.guild.id,
            voiceChannel: this.connection?.channel?.id,
            options: this.options,
            tracks: this.tracks.map((m) => m.toJSON())
        };
    }

    /**
     * String representation of this queue
     * @returns {string}
     */
    toString() {
        if (this.#watchDestroyed()) return;
        if (!this.tracks.length) return "No songs available to display!";
        return `**Upcoming Songs:**\n${this.tracks.map((m, i) => `${i + 1}. **${m.title}**`).join("\n")}`;
    }

    #watchDestroyed(emit = true) {
        if (this.#destroyed) {
            if (emit) this.player.emit("error", this, new PlayerError("Cannot use destroyed queue", ErrorStatusCode.DESTROYED_QUEUE));
            return true;
        }

        return false;
    }

    #getBufferingTimeout() {
        const timeout = this.options.bufferingTimeout;

        if (isNaN(timeout) || timeout < 0 || !Number.isFinite(timeout)) return 1000;
        return timeout;
    }
}

export { Queue };
