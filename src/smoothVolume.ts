
import { VolumeTransformer as VolumeTransformerMock } from "./VoiceInterface/VolumeTransformer";

try {
    // eslint-disable-next-line
    const mod = require("@discordjs/voice") as typeof import("@discordjs/voice") & { VolumeTransformer: typeof VolumeTransformerMock };

    if (typeof mod.VolumeTransformer.hasSmoothing !== "boolean") {
        Reflect.set(mod, "VolumeTransformer", VolumeTransformerMock);
    }
} catch {
    /* do nothing */
}
