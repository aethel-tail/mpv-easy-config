/** How an option is edited. The discriminant is what makes exhaustiveness checkable. */
export type Widget =
    | { kind: "flag"; def: boolean }
    | { kind: "choice"; choices: string[]; def: string }
    | { kind: "number"; min: number | null; max: number | null; def: string }
    | { kind: "list"; def: string }
    | { kind: "text"; def: string };

export interface OptionBase {
    /** Option name without the leading `--`. */
    name: string;
    /** First-level RST heading the option lives under. */
    section: string;
    /** English description as a Markdown subset. */
    en: string;
    /** sha256(en), first 12 hex chars: the cache key for translations. */
    textHash: string;
    /**
     * Section id on the mpv.io manual page, e.g. `gpu-renderer-options`.
     * The page has no per-option ids, so a deep link lands on the section.
     */
    sectionAnchor: string;    /** `[file]` in `mpv --list-options` output. */
    file: boolean;
    deprecated: boolean;
}

export type Option = OptionBase & { widget: Widget };

/** `site/data/options.json` */
export interface OptionsData {
    generatedAt: string;
    mpvCommit: string;
    /** mpv version whose `--list-options` supplied the metadata; may lag mpvCommit. */
    mpvVersion: string;
    /** Documented options that the mpv build did not report; they degrade to text. */
    degraded: string[];
    /** Options the mpv build reported but the manual does not describe; dropped. */
    undocumented: string[];
    options: Option[];
}

export type Lang = "zh" | "ja";

/** `site/data/cache.<lang>.json` */
export type TranslationCache = Record<string, string>;
