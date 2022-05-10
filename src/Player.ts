import { Client, Collection, GuildResolvable, Snowflake, User, VoiceState, GatewayIntentBits } from "discord.js";
import { TypedEmitter as EventEmitter } from "tiny-typed-emitter";
import { Queue } from "./Structures/Queue";
import { VoiceUtils } from "./VoiceInterface/VoiceUtils";
import { PlayerEvents, PlayerOptions, QueryType, SearchOptions, PlayerInitOptions, PlayerSearchResult } from "./types/types";
import Track from "./Structures/Track";
import { QueryResolver } from "./utils/QueryResolver";
import YouTube, { Video } from "youtube-sr";
import { Util } from "./utils/Util";
import fetch from 'cross-fetch';
import { PlayerError, ErrorStatusCode } from "./Structures/PlayerError";
import { getInfo as ytdlGetInfo } from "ytdl-core";
import { Client as SoundCloud, SearchResult as SoundCloudSearchResult } from "soundcloud-scraper";
import { Playlist } from "./Structures/Playlist";
import { ExtractorModel } from "./Structures/ExtractorModel";
import { generateDependencyReport } from "@discordjs/voice";
import { RawAlbum, RawPlaylist, search } from "./utils/AppleMusic";

const Spotify = require("spotify-url-info")(fetch)
const soundcloud = new SoundCloud();

class Player extends EventEmitter<PlayerEvents> {
    public readonly client: Client;
    public readonly options: PlayerInitOptions = {
        autoRegisterExtractor: true,
        ytdlOptions: {
            highWaterMark: 1 << 25
        },
        connectionTimeout: 20000
    };
    public readonly queues = new Collection<Snowflake, Queue>();
    public readonly voiceUtils = new VoiceUtils();
    public readonly extractors = new Collection<string, ExtractorModel>();
    public requiredEvents = ["error", "connectionError"] as string[];

    /**
     * Creates new Discord Portable Player
     * @param {Client} client The Discord Client
     * @param {PlayerInitOptions} [options={}] The player init options
     */
    constructor(client: Client, options: PlayerInitOptions = {}) {
        super();

        /**
         * The discord.js client
         * @type {Client}
         */
        this.client = client;

        if (this.client?.options?.intents && !new IntentsBitField(this.client?.options?.intents).has(GatewayIntentBits.GuildVoiceStates)) {
            throw new PlayerError('The client is missing "GuildVoiceStates" intent!');
        }

        /**
         * The extractors collection
         * @type {ExtractorModel}
         */
        this.options = Object.assign(this.options, options);

        this.client.on("voiceStateUpdate", this._handleVoiceState.bind(this));

        if (this.options?.autoRegisterExtractor) {
            let nv: any; // eslint-disable-line @typescript-eslint/no-explicit-any

            if ((nv = Util.require("@discord-player/extractor"))) {
                ["Attachment", "Facebook", "Reverbnation", "Vimeo"].forEach((ext) => void this.use(ext, nv[ext]));
            }
        }
    }

    /**
     * Handles voice state update
     * @param {VoiceState} oldState The old voice state
     * @param {VoiceState} newState The new voice state
     * @returns {void}
     * @private
     */
    private _handleVoiceState(oldState: VoiceState, newState: VoiceState): void {
        const queue = this.getGuildQueue(oldState.guild.id);
        if (!queue) return;

        if (oldState.channelId && newState && oldState.channelId !== newState.channelId) {
            if (queue?.connection && newState.member.id === newState.guild.me.id) queue.connection.channel = newState.channel;
            if (queue.connection.channel && newState.member.id === newState.guild.me.id || (newState.member.id !== newState.guild.me.id && oldState.channelId === queue.connection.channel.id)) {
                if (!Util.isVoiceEmpty(queue.connection.channel)) return;
                const timeout = setTimeout(() => {
                    if (!Util.isVoiceEmpty(queue.connection.channel)) return;
                    if (!this.queues.has(queue.guild.id)) return;
                    if (queue.options.leaveOnEmpty) queue.destroy();
                    this.emit("channelEmpty", queue);
                }, queue.options.leaveOnEmptyCooldown || 0).unref();
                queue._cooldownsTimeout.set(`empty_${oldState.guild.id}`, timeout);
            }

            if (!oldState.channelId && newState.channelId && newState.member.id === newState.guild.me.id) {
                if (newState.serverMute || !newState.serverMute) {
                    queue.setPaused(newState.serverMute);
                } else if (newState.suppress || !newState.suppress) {
                    if (newState.suppress) newState.guild.me.voice.setRequestToSpeak(true).catch(Util.noop);
                    queue.setPaused(newState.suppress);
                }
            }

            if (oldState.channelId === newState.channelId && oldState.member.id === newState.guild.me.id) {
                if (oldState.serverMute !== newState.serverMute) {
                    queue.setPaused(newState.serverMute);
                } else if (oldState.suppress !== newState.suppress) {
                    if (newState.suppress) newState.guild.me.voice.setRequestToSpeak(true).catch(Util.noop);
                    queue.setPaused(newState.suppress);
                }
            }

            if (oldState.member.id === this.client.user.id && !newState.channelId) {
                queue.connection.channel = oldState.channel;
                queue.destroy();
                return void this.emit("botDisconnect", queue);
            }

            if (!queue.connection || !queue.connection.channel) return;

            if (!oldState.channelId || newState.channelId) {
                const emptyTimeout = queue._cooldownsTimeout.get(`empty_${oldState.guild.id}`);
                const channelEmpty = Util.isVoiceEmpty(queue.connection.channel);

                if (newState.channelId === queue.connection.channel.id) {
                    if (!channelEmpty && emptyTimeout) {
                        clearTimeout(emptyTimeout);
                        queue._cooldownsTimeout.delete(`empty_${oldState.guild.id}`);
                    }
                }
            } else {
                if (oldState.channelId === queue.connection.channel.id) {
                    if (!Util.isVoiceEmpty(queue.connection.channel)) return;
                    const timeout = setTimeout(() => {
                        if (!Util.isVoiceEmpty(queue.connection.channel)) return;
                        if (!this.queues.has(queue.guild.id)) return;
                        if (queue.options.leaveOnEmpty) queue.destroy();
                        this.emit("channelEmpty", queue);
                    }, queue.options.leaveOnEmptyCooldown || 0).unref();
                    queue._cooldownsTimeout.set(`empty_${oldState.guild.id}`, timeout);
                }
            }
        }
    }

    /**
     * Creates a queue for a guild if not available, else returns existing queue
     * @param {GuildResolvable} guild The guild
     * @param {PlayerOptions} queueInitOptions Queue init options
     * @returns {guildQueue}
     */
    createGuildQueue<T = unknown>(guild: GuildResolvable, queueInitOptions: PlayerOptions & { metadata?: T } = {}): Queue<T> {
        guild = this.client.guilds.resolve(guild);
        if (!guild) throw new PlayerError("Unknown Guild", ErrorStatusCode.UNKNOWN_GUILD);
        if (this.queues.has(guild.id)) return this.queues.get(guild.id) as guildQueue<T>;

        const _meta = queueInitOptions.metadata;
        delete queueInitOptions["metadata"];
        queueInitOptions.volumeSmoothness ??= 0.08;
        queueInitOptions.ytdlOptions ??= this.options.ytdlOptions;
        const queue = new Queue(this, guild, queueInitOptions);
        queue.metadata = _meta;
        this.queues.set(guild.id, queue);

        return queue as guildQueue<T>;
    }

    /**
     * Returns the queue if available
     * @param {GuildResolvable} guild The guild id
     * @returns {guildQueue}
     */
    getGuildQueue<T = unknown>(guild: GuildResolvable) {
        guild = this.client.guilds.resolve(guild);
        if (!guild) throw new PlayerError("Unknown Guild", ErrorStatusCode.UNKNOWN_GUILD);
        return this.queues.get(guild.id) as guildQueue<T>;
    }

    /**
     * Deletes a queue and returns deleted queue object
     * @param {GuildResolvable} guild The guild id to remove
     * @returns {guildQueue}
     */
    deleteGuildQueue<T = unknown>(guild: GuildResolvable) {
        guild = this.client.guilds.resolve(guild);
        if (!guild) throw new PlayerError("Unknown Guild", ErrorStatusCode.UNKNOWN_GUILD);
        const prev = this.getGuildQueue<T>(guild);

        try {
            prev.destroy();
        } catch {} // eslint-disable-line no-empty
        this.queues.delete(guild.id);

        return prev;
    }

    /**
     * @typedef {object} PlayerSearchResult
     * @property {Playlist} [playlist] The playlist (if any)
     * @property {Track[]} tracks The tracks
     */
    /**
     * Search tracks
     * @param {string|Track} query The search query
     * @param {SearchOptions} options The search options
     * @returns {Promise<PlayerSearchResult>}
     */
    async search(query: string | Track, options: SearchOptions): Promise<PlayerSearchResult> {
        if (query instanceof Track) return { playlist: query.playlist || null, tracks: [query] };
        if (!options) throw new PlayerError("DiscordPlayer#search needs search options!", ErrorStatusCode.INVALID_ARG_TYPE);
        options.requestedBy = this.client.users.resolve(options.requestedBy);
        if (!("searchEngine" in options)) options.searchEngine = QueryType.Auto;
        if (typeof options.searchEngine === "string" && this.extractors.has(options.searchEngine)) {
            const extractor = this.extractors.get(options.searchEngine);
            if (!extractor.validate(query)) return { playlist: null, tracks: [] };
            const data = await extractor.handle(query);
            if (data && data.data.length) {
                const playlist = !data.playlist
                    ? null
                    : new Playlist(this, {
                          ...data.playlist,
                          tracks: []
                      });

                const tracks = data.data.map(
                    (m) =>
                        new Track(this, {
                            ...m,
                            requestedBy: options.requestedBy as User,
                            duration: Util.buildTimeCode(Util.parseMS(m.duration)),
                            playlist: playlist
                        })
                );

                if (playlist) playlist.tracks = tracks;

                return { playlist: playlist, tracks: tracks };
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for (const [_, extractor] of this.extractors) {
            if (options.blockExtractor) break;
            if (!extractor.validate(query)) continue;
            const data = await extractor.handle(query);
            if (data && data.data.length) {
                const playlist = !data.playlist
                    ? null
                    : new Playlist(this, {
                          ...data.playlist,
                          tracks: []
                      });

                const tracks = data.data.map(
                    (m) =>
                        new Track(this, {
                            ...m,
                            requestedBy: options.requestedBy as User,
                            duration: Util.buildTimeCode(Util.parseMS(m.duration)),
                            playlist: playlist
                        })
                );

                if (playlist) playlist.tracks = tracks;

                return { playlist: playlist, tracks: tracks };
            }
        }

        const qt = options.searchEngine === QueryType.Auto ? QueryResolver.resolve(query) : options.searchEngine;
        switch (qt) {
            case QueryType.AppleMusicTrack: {
                const data = await search(query);
                const videos = await YouTube.search(data.title, {
                    type: "video"
                });
                if (!videos) return null;

                const track = new Track(this, {
                    title: data.title,
                    description: videos[0].description,
                    artist: videos[0].channel.name,
                    url: videos[0].url,
                    requestedBy: options.requestedBy as User,
                    thumbnail: videos[0].thumbnail.url,
                    views: 0,
                    duration: videos[0].durationFormatted,
                    source: "applemusic",
                    raw: videos[0]
                });

                return { playlist: null, tracks: [track] };
            }
            case QueryType.AppleMusicAlbum:
            case QueryType.AppleMusicPlaylist: {
                const data = (await search(query)) as RawAlbum | RawPlaylist;

                const playlist = new Playlist(this, {
                    title: data.title,
                    thumbnail: data.thumbnail,
                    description: data.description,
                    type: "playlist",
                    source: "applemusic",
                    artist: {
                        name: data.type === "playlist" ? data.creator.name : data.artist.name,
                        url: data.type === "playlist" ? data.creator.url : data.artist.url
                    },
                    tracks: [],
                    id: "",
                    url: query,
                    rawPlaylist: data
                });

                for (const m of data.tracks) {
                    const videos = (await YouTube.search(m.title, {
                        type: "video"
                    }).catch(Util.noop)) as Video[];

                    const data = new Track(this, {
                        title: videos[0].title ?? "",
                        description: videos[0].description ?? "",
                        artist: m.artist.name ?? "Unknown Artist",
                        url: videos[0].url,
                        thumbnail: videos[0].thumbnail.url ?? "https://www.scdn.co/i/_global/twitter_card-default.jpg",
                        duration: videos[0].durationFormatted,
                        views: 0,
                        requestedBy: options.requestedBy as User,
                        source: "applemusic"
                    });

                    playlist.tracks.push(data);
                }

                return { playlist: playlist, tracks: playlist.tracks };
            }
            case QueryType.YouTubeVideo: {
                const info = await ytdlGetInfo(query, this.options.ytdlOptions).catch(Util.noop);
                if (!info) return { playlist: null, tracks: [] };

                const track = new Track(this, {
                    title: info.videoDetails.title,
                    description: info.videoDetails.description,
                    artist: info.videoDetails.author?.name,
                    url: info.videoDetails.video_url,
                    requestedBy: options.requestedBy as User,
                    thumbnail: Util.last(info.videoDetails.thumbnails)?.url,
                    views: parseInt(info.videoDetails.viewCount.replace(/[^0-9]/g, "")) || 0,
                    duration: Util.buildTimeCode(Util.parseMS(parseInt(info.videoDetails.lengthSeconds) * 1000)),
                    source: "youtube",
                    raw: info
                });

                return { playlist: null, tracks: [track] };
            }
            case QueryType.YouTubeSearch: {
                const videos = await YouTube.search(query, {
                    type: "video"
                }).catch(Util.noop);
                if (!videos) return { playlist: null, tracks: [] };

                const tracks = videos.map((m) => {
                    (m as any).source = "youtube"; // eslint-disable-line @typescript-eslint/no-explicit-any
                    return new Track(this, {
                        title: m.title,
                        description: m.description,
                        artist: m.channel?.name,
                        url: m.url,
                        requestedBy: options.requestedBy as User,
                        thumbnail: m.thumbnail?.displayThumbnailURL("maxresdefault"),
                        views: m.views,
                        duration: m.durationFormatted,
                        source: "youtube",
                        raw: m
                    });
                });

                return { playlist: null, tracks };
            }
            case QueryType.SoundCloudTrack:
            case QueryType.SoundCloudSearch: {
                const result: SoundCloudSearchResult[] = QueryResolver.resolve(query) === QueryType.SoundCloudTrack ? [{ url: query }] : await soundcloud.search(query, "track").catch(() => []);
                if (!result || !result.length) return { playlist: null, tracks: [] };
                const res: Track[] = [];

                for (const r of result) {
                    const trackInfo = await soundcloud.getSongInfo(r.url).catch(Util.noop);
                    if (!trackInfo) continue;

                    const track = new Track(this, {
                        title: trackInfo.title,
                        url: trackInfo.url,
                        duration: Util.buildTimeCode(Util.parseMS(trackInfo.duration)),
                        description: trackInfo.description,
                        thumbnail: trackInfo.thumbnail,
                        views: trackInfo.playCount,
                        artist: trackInfo.author.name,
                        requestedBy: options.requestedBy,
                        source: "soundcloud",
                        engine: trackInfo
                    });

                    res.push(track);
                }

                return { playlist: null, tracks: res };
            }
            case QueryType.SpotifySong: {
                const spotifyData = await Spotify.getData(query).catch(Util.noop);
                if (!spotifyData) return { playlist: null, tracks: [] };
                const spotifyTrack = new Track(this, {
                    title: spotifyData.name,
                    description: spotifyData.description ?? "",
                    artist: spotifyData.artists[0]?.name ?? "Unknown Artist",
                    url: spotifyData.external_urls?.spotify ?? query,
                    thumbnail:
                        spotifyData.album?.images[0]?.url ?? spotifyData.preview_url?.length
                            ? `https://i.scdn.co/image/${spotifyData.preview_url?.split("?cid=")[1]}`
                            : "https://www.scdn.co/i/_global/twitter_card-default.jpg",
                    duration: Util.buildTimeCode(Util.parseMS(spotifyData.duration_ms)),
                    views: 0,
                    requestedBy: options.requestedBy,
                    source: "spotify"
                });

                return { playlist: null, tracks: [spotifyTrack] };
            }
            case QueryType.SpotifyPlaylist:
            case QueryType.SpotifyAlbum: {
                const spotifyPlaylist = await Spotify.getData(query).catch(Util.noop);
                if (!spotifyPlaylist) return { playlist: null, tracks: [] };

                const playlist = new Playlist(this, {
                    title: spotifyPlaylist.name ?? spotifyPlaylist.title,
                    description: spotifyPlaylist.description ?? "",
                    thumbnail: spotifyPlaylist.images[0]?.url ?? "https://www.scdn.co/i/_global/twitter_card-default.jpg",
                    type: spotifyPlaylist.type,
                    source: "spotify",
                    artist:
                        spotifyPlaylist.type !== "playlist"
                            ? {
                                  name: spotifyPlaylist.artists[0]?.name ?? "Unknown Artist",
                                  url: spotifyPlaylist.artists[0]?.external_urls?.spotify ?? null
                              }
                            : {
                                  name: spotifyPlaylist.owner?.display_name ?? spotifyPlaylist.owner?.id ?? "Unknown Artist",
                                  url: spotifyPlaylist.owner?.external_urls?.spotify ?? null
                              },
                    tracks: [],
                    id: spotifyPlaylist.id,
                    url: spotifyPlaylist.external_urls?.spotify ?? query,
                    rawPlaylist: spotifyPlaylist
                });

                if (spotifyPlaylist.type !== "playlist") {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    playlist.tracks = spotifyPlaylist.tracks.items.map((m: any) => {
                        const data = new Track(this, {
                            title: m.name ?? "",
                            description: m.description ?? "",
                            artist: m.artists[0]?.name ?? "Unknown Artist",
                            url: m.external_urls?.spotify ?? query,
                            thumbnail: spotifyPlaylist.images[0]?.url ?? "https://www.scdn.co/i/_global/twitter_card-default.jpg",
                            duration: Util.buildTimeCode(Util.parseMS(m.duration_ms)),
                            views: 0,
                            requestedBy: options.requestedBy as User,
                            playlist,
                            source: "spotify"
                        });

                        return data;
                    }) as Track[];
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    playlist.tracks = spotifyPlaylist.tracks.items.map((m: any) => {
                        const data = new Track(this, {
                            title: m.track.name ?? "",
                            description: m.track.description ?? "",
                            artist: m.track.artists[0]?.name ?? "Unknown Artist",
                            url: m.track.external_urls?.spotify ?? query,
                            thumbnail: m.track.album?.images[0]?.url ?? "https://www.scdn.co/i/_global/twitter_card-default.jpg",
                            duration: Util.buildTimeCode(Util.parseMS(m.track.duration_ms)),
                            views: 0,
                            requestedBy: options.requestedBy as User,
                            playlist,
                            source: "spotify"
                        });

                        return data;
                    }) as Track[];
                }

                return { playlist: playlist, tracks: playlist.tracks };
            }
            case QueryType.SoundCloudPlaylist: {
                const data = await soundcloud.getPlaylist(query).catch(Util.noop);
                if (!data) return { playlist: null, tracks: [] };

                const res = new Playlist(this, {
                    title: data.title,
                    description: data.description ?? "",
                    thumbnail: data.thumbnail ?? "https://soundcloud.com/pwa-icon-192.png",
                    type: "playlist",
                    source: "soundcloud",
                    artist: {
                        name: data.author?.name ?? data.author?.username ?? "Unknown Artist",
                        url: data.author?.profile
                    },
                    tracks: [],
                    id: `${data.id}`, // stringified
                    url: data.url,
                    rawPlaylist: data
                });

                for (const song of data.tracks) {
                    const track = new Track(this, {
                        title: song.title,
                        description: song.description ?? "",
                        artist: song.author?.username ?? song.author?.name ?? "Unknown Artist",
                        url: song.url,
                        thumbnail: song.thumbnail,
                        duration: Util.buildTimeCode(Util.parseMS(song.duration)),
                        views: song.playCount ?? 0,
                        requestedBy: options.requestedBy,
                        playlist: res,
                        source: "soundcloud",
                        engine: song
                    });
                    res.tracks.push(track);
                }

                return { playlist: res, tracks: res.tracks };
            }
            case QueryType.YouTubePlaylist: {
                const ytpl = await YouTube.getPlaylist(query).catch(Util.noop);
                if (!ytpl) return { playlist: null, tracks: [] };

                await ytpl.fetch().catch(Util.noop);

                const playlist: Playlist = new Playlist(this, {
                    title: ytpl.title,
                    thumbnail: ytpl.thumbnail as unknown as string,
                    description: "",
                    type: "playlist",
                    source: "youtube",
                    artist: {
                        name: ytpl.channel.name,
                        url: ytpl.channel.url
                    },
                    tracks: [],
                    id: ytpl.id,
                    url: ytpl.url,
                    rawPlaylist: ytpl
                });

                playlist.tracks = ytpl.videos.map(
                    (video) =>
                        new Track(this, {
                            title: video.title,
                            description: video.description,
                            artist: video.channel?.name,
                            url: video.url,
                            requestedBy: options.requestedBy as User,
                            thumbnail: video.thumbnail.url,
                            views: video.views,
                            duration: video.durationFormatted,
                            raw: video,
                            playlist: playlist,
                            source: "youtube"
                        })
                );

                return { playlist: playlist, tracks: playlist.tracks };
            }
            default:
                return { playlist: null, tracks: [] };
        }
    }

    /**
     * Registers extractor
     * @param {string} extractorName The extractor name
     * @param {ExtractorModel|any} extractor The extractor object
     * @param {boolean} [force=false] Overwrite existing extractor with this name (if available)
     * @returns {ExtractorModel}
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    use(extractorName: string, extractor: ExtractorModel | any, force = false): ExtractorModel {
        if (!extractorName) throw new PlayerError("Cannot use unknown extractor!", ErrorStatusCode.UNKNOWN_EXTRACTOR);
        if (this.extractors.has(extractorName) && !force) return this.extractors.get(extractorName);
        if (extractor instanceof ExtractorModel) {
            this.extractors.set(extractorName, extractor);
            return extractor;
        }

        for (const method of ["validate", "getInfo"]) {
            if (typeof extractor[method] !== "function") throw new PlayerError("Invalid extractor data!", ErrorStatusCode.INVALID_EXTRACTOR);
        }

        const model = new ExtractorModel(extractorName, extractor);
        this.extractors.set(model.name, model);

        return model;
    }

    /**
     * Removes registered extractor
     * @param {string} extractorName The extractor name
     * @returns {ExtractorModel}
     */
    unuse(extractorName: string) {
        if (!this.extractors.has(extractorName)) throw new PlayerError(`Cannot find extractor "${extractorName}"`, ErrorStatusCode.UNKNOWN_EXTRACTOR);
        const prev = this.extractors.get(extractorName);
        this.extractors.delete(extractorName);
        return prev;
    }

    /**
     * Generates a report of the dependencies used by the `@discordjs/voice` module. Useful for debugging.
     * @returns {string}
     */
    scanDeps() {
        const line = "-".repeat(50);
        const depsReport = generateDependencyReport();
        const extractorReport = this.extractors
            .map((m) => {
                return `${m.name} :: ${m.version || "0.1.0"}`;
            })
            .join("\n");
        return `${depsReport}\n${line}\nLoaded Extractors:\n${extractorReport || "None"}`;
    }

    emit<U extends keyof PlayerEvents>(eventName: U, ...args: Parameters<PlayerEvents[U]>): boolean {
        if (this.requiredEvents.includes(eventName) && !super.eventNames().includes(eventName)) {
            // eslint-disable-next-line no-console
            console.error(...args);
            process.emitWarning(`[DiscordPlayerWarning] Unhandled "${eventName}" event! Events ${this.requiredEvents.map((m) => `"${m}"`).join(", ")} must have event listeners!`);
            return false;
        } else {
            return super.emit(eventName, ...args);
        }
    }

    /**
     * Resolves queue
     * @param {GuildResolvable|Queue} queueLike Queue like object
     * @returns {Queue}
     */
    resolveQueue<T>(queueLike: GuildResolvable | Queue): Queue<T> {
        return this.getQueue(queueLike instanceof Queue ? queueLike.guild : queueLike);
    }

    *[Symbol.iterator]() {
        yield* Array.from(this.queues.values());
    }
}

export { Player };
