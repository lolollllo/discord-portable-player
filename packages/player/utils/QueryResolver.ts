import { validateID, validateURL } from "ytdl-core";
import { YouTube } from "youtube-sr";
import { QueryType } from "../types/types";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { validateURL as SoundcloudValidateURL } from "soundcloud-scraper";

// scary things below *sigh*
const spotifySongRegex = /https?:\/\/(?:embed\.|open\.)(?:spotify\.com\/)(?:track\/|\?uri=spotify:track:)((\w|-){22})/;
const spotifyPlaylistRegex = /https?:\/\/(?:embed\.|open\.)(?:spotify\.com\/)(?:playlist\/|\?uri=spotify:playlist:)((\w|-){22})/;
const spotifyAlbumRegex = /https?:\/\/(?:embed\.|open\.)(?:spotify\.com\/)(?:album\/|\?uri=spotify:album:)((\w|-){22})/;
const vimeoRegex = /(http|https)?:\/\/(www\.|player\.)?vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/([^/]*)\/videos\/|video\/|)(\d+)(?:|\/\?)/;
const facebookRegex = /(https?:\/\/)(www\.|m\.)?(facebook|fb).com\/.*\/videos\/.*/;
const reverbnationRegex = /https:\/\/(www.)?reverbnation.com\/(.+)\/song\/(.+)/;
const appleMusicTrack = /https?:\/\/music\.apple\.com\/.+?\/album\/.+?\/.+?\?i=([0-9]+)/;
const appleMusicPlaylist = /https?:\/\/music\.apple\.com\/.+?\/playlist\//;
const appleMusicAlbum = /https?:\/\/music\.apple\.com\/.+?\/album\//;
const attachmentRegex =
    /^(?:(?:https?|ftp):\/\/)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:\/\S*)?$/;
// scary things above *sigh*

class QueryResolver {
    /**
     * Query resolver
     */
    private constructor() {} // eslint-disable-line @typescript-eslint/no-empty-function

    /**
     * Resolves the given search query
     * @param {string} query The query
     * @returns {QueryType}
     */
    static resolve(query: string): QueryType {
        if (SoundcloudValidateURL(query, "track")) return QueryType.SoundCloudTrack;
        if (SoundcloudValidateURL(query, "playlist") || query.includes("/sets/")) return QueryType.SoundCloudPlaylist;
        if (YouTube.isPlaylist(query)) return QueryType.YouTubePlaylist;
        if (validateID(query) || validateURL(query)) return QueryType.YouTubeVideo;
        if (spotifySongRegex.test(query)) return QueryType.SpotifySong;
        if (spotifyPlaylistRegex.test(query)) return QueryType.SpotifyPlaylist;
        if (spotifyAlbumRegex.test(query)) return QueryType.SpotifyAlbum;
        if (vimeoRegex.test(query)) return QueryType.Vimeo;
        if (facebookRegex.test(query)) return QueryType.Facebook;
        if (reverbnationRegex.test(query)) return QueryType.Reverbnation;
        if (attachmentRegex.test(query)) return QueryType.Arbitrary;
        if (appleMusicTrack.test(query)) return QueryType.AppleMusicTrack;
        if (appleMusicPlaylist.test(query)) return QueryType.AppleMusicPlaylist;
        if (appleMusicAlbum.test(query)) return QueryType.AppleMusicAlbum;

        return QueryType.YouTubeSearch;
    }

    /**
     * Parses vimeo id from url
     * @param {string} query The query
     * @returns {string}
     */
    static getVimeoID(query: string): string {
        return QueryResolver.resolve(query) === QueryType.Vimeo
            ? query
                  .split("/")
                  .filter((x) => !!x)
                  .pop()
            : null;
    }
}

export { QueryResolver };