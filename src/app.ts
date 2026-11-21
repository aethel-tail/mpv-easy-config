import type { OptionsData } from "./types.js";

async function loadOptions(): Promise<OptionsData | null> {
    const res = await fetch("./data/options.json", { cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as OptionsData;
}

export async function boot(): Promise<void> {
    const mount = document.querySelector<HTMLElement>("#app");
    if (!mount) throw new Error("missing #app");

    const data = await loadOptions();
    if (!data) {
        mount.textContent = "options data not generated yet (M1)";
        return;
    }

    const kinds = new Map<string, number>();
    for (const option of data.options) {
        kinds.set(option.widget.kind, (kinds.get(option.widget.kind) ?? 0) + 1);
    }
    const summary = [...kinds].map(([kind, n]) => `${kind} ${n}`).join(" · ");

    mount.textContent = `${data.options.length} options · mpv master@${data.mpvCommit.slice(0, 7)} · ${summary}`;
}

void boot();
