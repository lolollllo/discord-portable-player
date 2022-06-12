import { FiltersName } from "../types/types";

const bass = (g: number) => `bass=g=${g}:f=110:w=0.3`;

/**
 * The available audio filters
 * @typedef {object} AudioFilters
 * @property {boolean} bassboost_low The bassboost filter (+15dB)
 * @property {boolean} bassboost The bassboost filter (+20dB)
 * @property {boolean} bassboost_high The bassboost filter (+30dB)
 * @property {boolean} eight_d The 8D filter
 * @property {boolean} vaporwave The vaporwave filter
 * @property {boolean} nightcore The nightcore filter
 * @property {boolean} phaser The phaser filter
 * @property {boolean} tremolo The tremolo filter
 * @property {boolean} vibrato The vibrato filter
 * @property {boolean} reverse The reverse filter
 * @property {boolean} treble The treble filter
 * @property {boolean} normalizer The normalizer filter (dynamic audio normalizer based)
 * @property {boolean} normalizer2 The normalizer filter (audio compressor based)
 * @property {boolean} surrounding The surrounding filter
 * @property {boolean} pulsator The pulsator filter
 * @property {boolean} subboost The subboost filter
 * @property {boolean} karaoke The kakaoke filter
 * @property {boolean} flanger The flanger filter
 * @property {boolean} gate The gate filter
 * @property {boolean} haas The haas filter
 * @property {boolean} mcompand The mcompand filter
 * @property {boolean} mono The mono filter
 * @property {boolean} mstlr The mstlr filter
 * @property {boolean} mstrr The mstrr filter
 * @property {boolean} compressor The compressor filter
 * @property {boolean} expander The expander filter
 * @property {boolean} softlimiter The softlimiter filter
 * @property {boolean} chorus The chorus filter
 * @property {boolean} chorus2d The chorus2d filter
 * @property {boolean} chorus3d The chorus3d filter
 * @property {boolean} fadein The fadein filter
 * @property {boolean} dim The dim filter
 * @property {boolean} earrape The earrape filter
 */

const FilterList = {
    bassboost_low: bass(15),
    bassboost: bass(20),
    bassboost_high: bass(30),
    eight_d: "apulsator=hz=0.09",
    vaporwave: "aresample=48000,asetrate=48000*0.8",
    nightcore: "aresample=48000,asetrate=48000*1.25",
    phaser: "aphaser=in_gain=0.4",
    tremolo: "tremolo",
    vibrato: "vibrato=f=6.5",
    reverse: "areverse",
    treble: "treble=g=5",
    normalizer: "dynaudnorm=g=101",
    normalizer2: "acompressor",
    surrounding: "surround",
    pulsator: "apulsator=hz=1",
    subboost: "asubboost",
    karaoke: "stereotools=mlev=0.03",
    flanger: "flanger",
    gate: "agate",
    haas: "haas",
    mcompand: "mcompand",
    mono: "pan=mono|c0=.5*c0+.5*c1",
    mstlr: "stereotools=mode=ms>lr",
    mstrr: "stereotools=mode=ms>rr",
    compressor: "compand=points=-80/-105|-62/-80|-15.4/-15.4|0/-12|20/-7.6",
    expander: "compand=attacks=0:points=-80/-169|-54/-80|-49.5/-64.6|-41.1/-41.1|-25.8/-15|-10.8/-4.5|0/0|20/8.3",
    softlimiter: "compand=attacks=0:points=-80/-80|-12.4/-12.4|-6/-8|0/-6.8|20/-2.8",
    chorus: "chorus=0.7:0.9:55:0.4:0.25:2",
    chorus2d: "chorus=0.6:0.9:50|60:0.4|0.32:0.25|0.4:2|1.3",
    chorus3d: "chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3",
    fadein: "afade=t=in:ss=0:d=10",
    dim: `afftfilt="'real=re * (1-clip((b/nb)*b,0,1))':imag='im * (1-clip((b/nb)*b,0,1))'"`,
    earrape: "channelsplit,sidechaingate=level_in=64",

    *[Symbol.iterator](): IterableIterator<{ name: FiltersName; value: string }> {
        for (const [k, v] of Object.entries(this)) {
            if (typeof this[k as FiltersName] === "string") yield { name: k as FiltersName, value: v as string };
        }
    },

    get names() {
        return Object.keys(this).filter((p) => !["names", "length"].includes(p) && typeof this[p as FiltersName] !== "function") as FiltersName[];
    },

    get length() {
        return Object.keys(this).filter((p) => !["names", "length"].includes(p) && typeof this[p as FiltersName] !== "function").length;
    },

    toString() {
        return this.names.map((m) => (this as any)[m]).join(","); // eslint-disable-line @typescript-eslint/no-explicit-any
    },

    create(filter?: FiltersName[]): string {
        if (!filter || !Array.isArray(filter)) return this.toString();
        return filter
            .filter((predicate) => typeof predicate === "string")
            .map((m) => this[m])
            .join(",");
    },

    define(filterName: string, value: string): void {
        if (typeof this[filterName as FiltersName] && typeof this[filterName as FiltersName] === "function") return;

        this[filterName as FiltersName] = value;
    },

    defineBulk(filterArray: { name: string; value: string }[]): void {
        filterArray.forEach((arr) => this.define(arr.name, arr.value));
    }
};

export default FilterList;
export { FilterList as AudioFilters };
